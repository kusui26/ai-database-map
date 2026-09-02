/**
 * 駅別ハザードの事前計算バッチ（PR-6・`docs/260828_research_claude_auth.md` §5.3 ③・§10）。
 *
 * 全駅の代表点に対して、本番 API（`/api/hazard/point`）と**同じ読み取り・同じ組み立て**
 * （`meshReadings` + `tileReadings` → `assembleHazardPoint`）をオフライン実行し、
 * `shared/hazard-summary` の形へ射影して jsonl に書く。
 *
 * ⚠ **浸水ナビは呼ばない**（rivers=[]）。利用マニュアルの分間 30 制限では全駅 ×3 本 ≈ 19 時間
 * かかり、バッチに不適。区分値（タイル・メッシュ）は同じ想定を描いたものなので、
 * レベル（順序尺度）の答えは変わらない（§10 PR-6 方針・limitations に明記して配る）。
 *
 * 上流はハザードマップポータルのタイル CDN のみ。礼節：
 * - 駅を 1 次メッシュ順に並べ（近い駅が続く＝LRU が効く）、同時実行は既定 2 駅
 * - 再開可能（jsonl に追記・既出の grp はスキップ）。途中で止めても安全
 *
 * 実行（リポジトリ直下・ローカルに本番ビルドのサーバを立ててから）:
 *     PORT=3117 npm start &          # public/hazard/** を配る origin
 *     npx -y tsx pipeline/build_station_hazard.ts --base-url http://localhost:3117
 * オプション: --limit N（試験用）/ --concurrency N（既定 2）/ --out PATH
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { assembleHazardPoint } from '@/lib/hazard/point-source'
import { meshReadings, tileReadings } from '@/lib/hazard/readings'
import { stationHazardSummary } from '@/domain/hazard/summary'
import { STATION_HAZARD_VERSION, stationHazardSummarySchema } from '@/shared/hazard-summary'
import { meshCodeFromLonLat } from '@/shared/mesh'

const DATASET_CSV = 'data/derived/station_dataset.csv'
const DEFAULT_OUT = 'data/derived/station_hazard.jsonl'
const DEFAULT_CONCURRENCY = 2
/** 読み取りが欠けた駅の再試行回数（タイル CDN の瞬断向け）。 */
const RETRIES = 2
const PROGRESS_EVERY = 200

type Station = { readonly grp: string; readonly lon: number; readonly lat: number }

/** RFC 4180 の 1 行を分解する（駅名に引用・カンマがあっても壊れない）。 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  const buffer: string[] = []
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        buffer.push('"')
        i += 1
      } else if (ch === '"') quoted = false
      else buffer.push(ch ?? '')
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(buffer.join(''))
      buffer.length = 0
    } else buffer.push(ch ?? '')
  }
  cells.push(buffer.join(''))
  return cells
}

function readStations(): Station[] {
  const lines = readFileSync(DATASET_CSV, 'utf-8').split('\n').filter((line) => line.length > 0)
  const header = splitCsvLine(lines[0] ?? '')
  const at = (name: string): number => {
    const index = header.indexOf(name)
    if (index < 0) throw new Error(`${DATASET_CSV} に列がありません: ${name}`)
    return index
  }
  const [grpAt, lonAt, latAt] = [at('grp'), at('lon'), at('lat')]
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const [grp, lon, lat] = [cells[grpAt], Number(cells[lonAt]), Number(cells[latAt])]
    if (grp === undefined || grp.length === 0 || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`駅行を読めません: ${line.slice(0, 60)}`)
    }
    return { grp, lon, lat }
  })
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/** 既出の grp（再開用）。メタ行（type:"meta"）は飛ばす。 */
function doneGrps(outPath: string): Set<string> {
  if (!existsSync(outPath)) return new Set()
  const done = new Set<string>()
  for (const line of readFileSync(outPath, 'utf-8').split('\n')) {
    if (line.length === 0) continue
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) continue
    if ('type' in parsed && parsed.type === 'meta') {
      if (!('version' in parsed) || parsed.version !== STATION_HAZARD_VERSION) {
        throw new Error(`${outPath} の版が違います。別名で出力するか消してから再実行してください`)
      }
      continue
    }
    if ('grp' in parsed && typeof parsed.grp === 'string') done.add(parsed.grp)
  }
  return done
}

async function computeOne(station: Station, baseUrl: string): Promise<
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly notes: readonly string[] }
> {
  const [mesh, tile] = await Promise.all([
    meshReadings(station.lon, station.lat, baseUrl),
    tileReadings(station.lon, station.lat),
  ])
  // 浸水ナビは呼ばない（ファイル冒頭のとおり）。noteJa: null ＝欠けの扱いにしない。
  const result = assembleHazardPoint(
    { lon: station.lon, lat: station.lat, placeJa: station.grp },
    { mesh, tile, navi: { rivers: [], noteJa: null } },
  )
  if (!result.complete) {
    return { ok: false, notes: result.point.notesJa }
  }
  const summary = stationHazardSummarySchema.parse(
    stationHazardSummary(station.grp, result.point, result.uncoveredLayerKeys),
  )
  return { ok: true, line: JSON.stringify(summary) }
}

async function main(): Promise<number> {
  const baseUrl = argValue('--base-url') ?? 'http://localhost:3117'
  const outPath = argValue('--out') ?? DEFAULT_OUT
  const limit = Number(argValue('--limit') ?? 'NaN')
  const concurrency = Number(argValue('--concurrency') ?? String(DEFAULT_CONCURRENCY))

  // 配布メッシュに届くかを先に確かめる（全駅ぶん走ってから気づかない）。
  const probe = await fetch(`${baseUrl}/hazard/index.json`)
  if (!probe.ok) throw new Error(`配布メッシュに届きません（${probe.status}）: ${baseUrl}/hazard/index.json`)

  const all = readStations()
  // 1 次メッシュ（緯度経度ブロック）順＝近い駅が続き、タイル LRU が効く。
  const sorted = [...all].sort((a, b) =>
    meshCodeFromLonLat(a.lon, a.lat).localeCompare(meshCodeFromLonLat(b.lon, b.lat)),
  )
  const done = doneGrps(outPath)
  if (!existsSync(outPath) || done.size === 0) {
    appendFileSync(
      outPath,
      `${JSON.stringify({
        type: 'meta',
        version: STATION_HAZARD_VERSION,
        computedAt: new Date().toISOString(),
        source: 'pipeline/build_station_hazard.ts（meshReadings + tileReadings → assembleHazardPoint・浸水ナビなし）',
      })}\n`,
    )
  }
  const targets = sorted
    .filter((station) => !done.has(station.grp))
    .slice(0, Number.isFinite(limit) ? limit : sorted.length)
  console.log(
    `stations: ${all.length}（済 ${done.size}・今回 ${targets.length}）→ ${outPath} / baseUrl=${baseUrl} / 並列 ${concurrency}`,
  )

  const failures: { grp: string; notes: readonly string[] }[] = []
  let written = 0
  let cursor = 0
  const startedAt = Date.now()

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      const station = targets[index]
      if (station === undefined) return
      let outcome = await computeOne(station, baseUrl)
      for (let retry = 0; !outcome.ok && retry < RETRIES; retry += 1) {
        outcome = await computeOne(station, baseUrl)
      }
      if (outcome.ok) {
        appendFileSync(outPath, `${outcome.line}\n`)
        written += 1
      } else {
        failures.push({ grp: station.grp, notes: outcome.notes })
      }
      const finished = written + failures.length
      if (finished % PROGRESS_EVERY === 0) {
        const rate = finished / ((Date.now() - startedAt) / 1000)
        const eta = Math.round((targets.length - finished) / Math.max(rate, 0.01) / 60)
        console.log(
          `  ${finished}/${targets.length}（${rate.toFixed(1)} 駅/秒・残り ~${eta} 分・失敗 ${failures.length}）`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))

  console.log(`OK 書き込み ${written} 駅（累計 ${done.size + written}/${all.length}）`)
  if (failures.length > 0) {
    console.log(`⚠ 読み取りが欠けた駅 ${failures.length} 件（再実行で再試行されます）:`)
    for (const failure of failures.slice(0, 10)) {
      console.log(`  ${failure.grp}: ${failure.notes.join(' / ')}`)
    }
    return 1
  }
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
