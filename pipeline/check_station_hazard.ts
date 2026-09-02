/**
 * §11 データ整合の検証（PR-6）：**事前計算 ＝ ライブの同じ関数** を実測で確かめる。
 *
 * 事前計算（jsonl）から系統抽出した駅について、本番と同じ読み取り一式
 * （メッシュ＋公式タイル＋**浸水ナビあり**）→ `assembleHazardPoint` → 射影を実行し、
 * 保存済みサマリと比べる。
 *
 * 期待：**厳密フィールド（レベル・避難・nearby/uncovered・標高）は完全一致**。
 * バッチは浸水ナビを含めないが、区分値（タイル・メッシュ）と実測 m は同じ想定を描いた
 * ものなので、順序尺度のレベルは変わらない（§10 PR-6 方針）——ここを実測で裏取りする。
 * `worstJa`（実測 m の言い方が付く）だけは差が出うるので、参考として別掲する。
 *
 * 浸水ナビの分間 30 制限（実装は 24/分・1 地点 3 本）を守るため、駅間で 8 秒待つ。
 *
 *     PORT=3117 の静的サーバ（public/）を立ててから:
 *     npx -y tsx pipeline/check_station_hazard.ts --sample 48
 */

import { readFileSync } from 'node:fs'
import { assembleHazardPoint } from '@/lib/hazard/point-source'
import { meshReadings, tileReadings } from '@/lib/hazard/readings'
import { suibouNaviRivers } from '@/lib/hazard/suibou-navi'
import { stationHazardSummary } from '@/domain/hazard/summary'
import {
  SUMMARY_HAZARD_GROUPS,
  stationHazardSummarySchema,
  type StationHazardSummary,
} from '@/shared/hazard-summary'

const JSONL = 'data/derived/station_hazard.jsonl'
const DATASET_CSV = 'data/derived/station_dataset.csv'
/** 浸水ナビの窓（24/分・3 本/駅）に収まる駅間隔。 */
const PACE_MS = 8_000
const DEFAULT_SAMPLE = 48

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

type Station = { readonly grp: string; readonly lon: number; readonly lat: number }

/** 位置は station_dataset.csv から（ビルダーと同じ出所）。 */
function stationPositions(): Map<string, Station> {
  const lines = readFileSync(DATASET_CSV, 'utf-8').split('\n').filter((line) => line.length > 0)
  const header = (lines[0] ?? '').split(',')
  const [grpAt, lonAt, latAt] = [header.indexOf('grp'), header.indexOf('lon'), header.indexOf('lat')]
  const out = new Map<string, Station>()
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const grp = cells[grpAt]
    if (grp === undefined) continue
    out.set(grp, { grp, lon: Number(cells[lonAt]), lat: Number(cells[latAt]) })
  }
  return out
}

function storedSummaries(): StationHazardSummary[] {
  const out: StationHazardSummary[] = []
  for (const line of readFileSync(JSONL, 'utf-8').split('\n')) {
    if (line.length === 0) continue
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) continue
    out.push(stationHazardSummarySchema.parse(parsed))
  }
  return out
}

/** 厳密比較の対象（worstJa / headlineJa は浸水ナビの言い方が付くので別掲）。 */
function strictView(summary: StationHazardSummary): Record<string, unknown> {
  const groups: Record<string, unknown> = {}
  for (const group of SUMMARY_HAZARD_GROUPS) {
    const each = summary.groups[group]
    groups[group] = { level: each.level, nearby: each.nearby, uncovered: each.uncovered }
  }
  return {
    level: summary.level,
    evacuation: summary.evacuation,
    certainty: summary.certainty,
    elevationM: summary.elevationM,
    groups,
  }
}

type LiveResult = { readonly summary: StationHazardSummary; readonly naviOk: boolean }

/**
 * ライブの読み取り → 射影。浸水ナビが不達のときは**区分値のみで比較**する
 * （厳密フィールドの検証はバッチと同じ入力での同一性確認としてそのまま成立する。
 * ナビ由来の差の観測だけができない——件数を別掲して正直に報告する）。
 */
async function liveSummary(station: Station, baseUrl: string): Promise<LiveResult> {
  const [mesh, tile, naviTry] = await Promise.all([
    meshReadings(station.lon, station.lat, baseUrl),
    tileReadings(station.lon, station.lat),
    suibouNaviRivers(station.lon, station.lat, Date.now()),
  ])
  if (mesh.noteJa !== null || tile.noteJa !== null) {
    throw new Error(`読み取りが欠けました: ${[mesh.noteJa, tile.noteJa].filter((n) => n !== null).join(' / ')}`)
  }
  const naviOk = naviTry.noteJa === null
  const navi = naviOk ? { rivers: naviTry.rivers, noteJa: null } : { rivers: [], noteJa: null }
  const result = assembleHazardPoint(
    { lon: station.lon, lat: station.lat, placeJa: station.grp },
    { mesh, tile, navi },
  )
  return {
    summary: stationHazardSummary(station.grp, result.point, result.uncoveredLayerKeys),
    naviOk,
  }
}

async function main(): Promise<number> {
  const baseUrl = argValue('--base-url') ?? 'http://localhost:3117'
  const sampleSize = Number(argValue('--sample') ?? String(DEFAULT_SAMPLE))
  const positions = stationPositions()
  const stored = storedSummaries()
  // 系統抽出（保存順＝1 次メッシュ順なので、地理的に散らばる・決定的）。
  const step = Math.max(1, Math.floor(stored.length / sampleSize))
  const samples = stored.filter((_, index) => index % step === 0).slice(0, sampleSize)
  console.log(`§11 整合検証: ${samples.length} 駅（全 ${stored.length} から系統抽出・約 ${Math.round((samples.length * PACE_MS) / 60000)} 分）`)

  let strictMatch = 0
  let worstJaDiff = 0
  let naviMissed = 0
  const mismatches: string[] = []
  for (const [index, storedSummary] of samples.entries()) {
    const station = positions.get(storedSummary.grp)
    if (station === undefined) throw new Error(`位置が見つかりません: ${storedSummary.grp}`)
    // タイル CDN の瞬断はバッチと同じくリトライで越える（3 回目で諦めて throw）。
    let live: LiveResult | null = null
    for (let attempt = 0; live === null; attempt += 1) {
      try {
        live = await liveSummary(station, baseUrl)
      } catch (error) {
        if (attempt >= 2) throw error
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
    }
    if (!live.naviOk) naviMissed += 1
    const strictA = JSON.stringify(strictView(storedSummary))
    const strictB = JSON.stringify(strictView(live.summary))
    if (strictA === strictB) {
      strictMatch += 1
      const worstA = SUMMARY_HAZARD_GROUPS.map((g) => storedSummary.groups[g].worstJa).join('|')
      const worstB = SUMMARY_HAZARD_GROUPS.map((g) => live.summary.groups[g].worstJa).join('|')
      if (worstA !== worstB) worstJaDiff += 1
    } else {
      mismatches.push(`${storedSummary.grp}:\n  保存: ${strictA}\n  ライブ: ${strictB}`)
    }
    if ((index + 1) % 10 === 0) console.log(`  ${index + 1}/${samples.length}`)
    if (index < samples.length - 1) await new Promise((resolve) => setTimeout(resolve, PACE_MS))
  }

  console.log(
    `厳密一致: ${strictMatch}/${samples.length}・worstJa の言い方差（浸水ナビの実測 m・想定内）: ${worstJaDiff} 駅・` +
      `ナビ不達（区分値のみで比較）: ${naviMissed} 駅`,
  )
  if (mismatches.length > 0) {
    console.log('⚠ 厳密フィールドの不一致:')
    for (const each of mismatches) console.log(each)
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
