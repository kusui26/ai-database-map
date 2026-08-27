/**
 * 「どこに逃げるか」を組み立てる（**サーバ専用**・`docs/260824_flood.md` §3.5・§8.5）。
 *
 * `GET /api/hazard/evacuation` と **AI ツール `findEvacuationSites` の両方がここを通る**
 * （`point-source.ts` / `alert-source.ts` と同じ流儀）。
 *
 * ## 種別の絞り込みは二重にする
 *
 * ①**その種別のレイヤ**（`skhb01`〜`skhb08`）だけを取りに行き、
 * ②取れた地物の `disasterN` が立っていることも確かめる。
 * 実測では `skhb01` の全件に `disaster1` が立っていた（＝①だけで足りる）が、
 * **人命に関わる絞り込みを片方の前提だけに預けない**（§11 リスク 10）。
 *
 * ## 浸水想定区域の中かどうかは自前メッシュで見る
 *
 * 指定緊急避難場所でも、**想定最大規模では浸水しうる**。250m メッシュなら追加の通信なしに
 * 1 件ずつ見られる（タイルはプロセス内にキャッシュされている）。
 * メッシュが無い地域・メッシュ化していない種別では `null`＝「分からない」を返す
 * ——**分からないものを「安全」と言わない**（§7.5）。
 */

import { boundingBoxAround, tilesCovering } from '@/shared/geo'
import { HAZARD_DISCLAIMER_JA } from '@/shared/hazard'
import {
  disastersOfFeature,
  evacuationDisaster,
  evacuationDisasterLabelJa,
  evacuationTileSchema,
  EVACUATION_HAZARD_GROUP,
  EVACUATION_SITE_KIND_JA,
  type EvacuationDisasterKey,
  type EvacuationFeature,
} from '@/shared/evacuation'
import { hazardLayersForGroup } from '@/shared/hazard'
import type { HazardEvacuationResponse } from '@/shared/api'
import type { SourceRef } from '@/shared/protocol'
import {
  evacuationHeadlineJa,
  evacuationNotesJa,
  hazardAreaLabelJa,
  rankEvacuationSites,
  EVACUATION_LIMITATIONS_JA,
  EVACUATION_RADIUS_DEFAULT_M,
  EVACUATION_TOP_DEFAULT,
  type EvacuationCandidate,
  type HazardAreaCertainty,
} from '@/domain/hazard/evacuation'
import type { MeshReading } from '@/domain/hazard/point'
import { jmaMunicipality } from '@/shared/jma'
import { createLru, remember } from '@/lib/lru'
import { municipalityCodeAt } from './jma'
import { meshReadings } from './readings'

/** 地物タイルのネイティブズーム（国土地理院の配信・§3.5）。 */
const TILE_ZOOM = 10

/** 取りに行くタイルの上限。半径 20km でも 4 枚に収まる（1 枚 ≒ 32km 四方）。 */
const MAX_TILES = 6

const TILE_URL = 'https://maps.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.geojson'
const FETCH_TIMEOUT_MS = 8_000
/** タイルのキャッシュ容量（レイヤ 8 種 × 数タイル）。指定の一覧は滅多に変わらない。 */
const TILE_CACHE_CAPACITY = 64

/**
 * 浸水の判定にかける件数の上限。
 *
 * ⚠ **「近い順に N 件だけ」にしてはいけない。** 並びは「浸水想定区域の外が先」なので、
 * N 件目より遠い場所に区域外のものがあれば、それは打ち切った側に混ざったまま消える
 * ——**より安全な行き先が、近いという理由だけで表から落ちる**。だから半径内は全部見る。
 * 上限は暴走止め（実測：半径 5km で 亀有 21 件・新宿 59 件・氷見 87 件）。
 * メッシュのタイルはプロセス内に載っているので、1 件あたりは配列の読み出しに近い。
 */
const CHECKED_CANDIDATES = 300

/** 呼び名の既定。 */
export const DEFAULT_PLACE_JA = 'この地点'

const SOURCES: readonly SourceRef[] = [
  {
    labelJa: `出典：国土地理院 ${EVACUATION_SITE_KIND_JA}データ`,
    url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html',
    license: '国土地理院コンテンツ利用規約',
  },
]

export type HazardEvacuationRequest = {
  readonly lon: number
  readonly lat: number
  readonly placeJa?: string
  readonly disaster: EvacuationDisasterKey
  readonly radiusM?: number
  readonly top?: number
}

const tiles = createLru<string, Promise<readonly EvacuationFeature[]>>(TILE_CACHE_CAPACITY)

/** タイル 1 枚（取れなければ空。1 枚落ちても残りで答える）。 */
function loadTile(layer: string, x: number, y: number): Promise<readonly EvacuationFeature[]> {
  const url = TILE_URL.replace('{layer}', layer)
    .replace('{z}', String(TILE_ZOOM))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
  return remember(tiles, url, async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: controller.signal })
      // 海上・国外のタイルは 404。**エラーではなく「その範囲に無い」**なので空で返す。
      if (response.status === 404) return []
      if (!response.ok) throw new Error(`避難場所を取得できません（${response.status}）`)
      return evacuationTileSchema.parse(await response.json()).features
    } finally {
      clearTimeout(timer)
    }
  })
}

/** 半径に重なるタイルを集める（枚数は上限で切り、切ったことは注記に出す）。 */
async function loadFeatures(
  layer: string,
  lon: number,
  lat: number,
  radiusM: number,
): Promise<{ features: readonly EvacuationFeature[]; noteJa: string | null }> {
  const wanted = tilesCovering(boundingBoxAround(lon, lat, radiusM), TILE_ZOOM)
  const used = wanted.slice(0, MAX_TILES)
  const results = await Promise.allSettled(used.map((tile) => loadTile(layer, tile.x, tile.y)))
  const loaded = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const failed = results.length - results.filter((result) => result.status === 'fulfilled').length
  const notes = [
    ...(wanted.length > used.length ? [`範囲が広いため ${used.length} 区画ぶんだけ調べました`] : []),
    ...(failed > 0 ? [`避難場所のデータを ${failed} 区画ぶん取得できませんでした`] : []),
  ]
  return { features: loaded, noteJa: notes.length === 0 ? null : notes.join('。') }
}

/** 地物 → 候補（種別の二重確認つき）。名前が無いものは出さない（指し示せないため）。 */
function toCandidate(
  feature: EvacuationFeature,
  disaster: EvacuationDisasterKey,
): EvacuationCandidate | null {
  const supported = disastersOfFeature(feature)
  if (!supported.some((each) => each.key === disaster)) return null
  const nameJa = feature.properties.name ?? ''
  if (nameJa.length === 0) return null
  const remarks = feature.properties.remarks ?? ''
  return {
    nameJa,
    addressJa: feature.properties.address ?? '',
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    remarksJa: remarks.length === 0 ? null : remarks,
    disastersJa: supported.map((each) => each.labelJa),
    hazardAreaCertainty: null,
    elevationM: null,
  }
}

/**
 * その災害の想定区域に**含まれていないレイヤ**の集合（自前メッシュで見られるものだけ）。
 * 種別にメッシュが無ければ空——呼び出し側はそれを「判定できない」に翻訳する。
 */
function meshLayerKeysFor(disaster: EvacuationDisasterKey): ReadonlySet<string> {
  const group = EVACUATION_HAZARD_GROUP[disaster]
  if (group === null) return new Set()
  return new Set(
    hazardLayersForGroup(group)
      .filter((layer) => layer.mesh?.available === true)
      .map((layer) => layer.key),
  )
}

/**
 * その場所と**その災害の**想定区域の重なり方（250m メッシュ）。**分からなければ `null`**。
 *
 * 見るのは聞かれた種別のレイヤだけ（`EVACUATION_HAZARD_GROUP` に理由を書いた）。
 * 1 レイヤも読めなければ「分からない」を返す——読めなかったことを「区域の外」にしない。
 *
 * **真偽値にしない。** セルが持つのは「セル内の最大」なので、`0` でないことは
 * 「この点が区域内」ではなく「セルのどこかが区域」でしかない（§5.9）。
 * 被覆率の両端（0＝一切かからない／1＝全域）だけを言い切り、間は `'partial'` に落とす。
 */
function certaintyOf(readings: readonly MeshReading[]): HazardAreaCertainty {
  if (readings.length === 0) return null
  if (readings.every((reading) => reading.coverage === 0)) return 'outside'
  return readings.some((reading) => reading.coverage === 1) ? 'inside' : 'partial'
}

async function withHazardCheck(
  candidate: EvacuationCandidate,
  layerKeys: ReadonlySet<string>,
  baseUrl: string,
): Promise<EvacuationCandidate> {
  const readings = await meshReadings(candidate.lon, candidate.lat, baseUrl)
  const relevant = readings.mesh.filter((reading) => layerKeys.has(reading.layerKey))
  return {
    ...candidate,
    hazardAreaCertainty: certaintyOf(relevant),
    elevationM: readings.elevationM,
  }
}

/**
 * 近い順に上限まで絞ってから、浸水の判定をかける。
 * この時点では `hazardAreaCertainty` が全件 `null` なので、並べ替えは**距離だけ**で決まる。
 */
function nearestFirst(
  lon: number,
  lat: number,
  candidates: readonly EvacuationCandidate[],
  radiusM: number,
): { within: readonly EvacuationCandidate[]; droppedCount: number } {
  const within = rankEvacuationSites({ lon, lat }, candidates, candidates.length).filter(
    (site) => site.distanceM <= radiusM,
  )
  return {
    within: within.slice(0, CHECKED_CANDIDATES),
    droppedCount: Math.max(0, within.length - CHECKED_CANDIDATES),
  }
}

/**
 * その地点の市区町村の場所が 1 つも入っていないときの注記。
 *
 * ⚠ **国土地理院のデータは市町村からの提供**なので、**まるごと未登録の市がある**。
 * 実測（2026-08-27・熱海市）では、津波（`skhb05`）は 6 件あるのに
 * **洪水・土砂・地震は 0 件**で、土砂の避難場所を聞くと**隣の湯河原町（4.2km 先）**が並んだ。
 * 黙って隣町へ誘導するのは危ない——「近くに無い」のか「登録が無い」のかを言い分ける。
 */
function outOfMunicipalityNoteJa(
  municipalityJa: string | null,
  disasterJa: string,
  candidates: readonly EvacuationCandidate[],
): readonly string[] {
  if (municipalityJa === null) return []
  if (candidates.some((candidate) => candidate.addressJa.includes(municipalityJa))) return []
  return [
    `この一覧に**${municipalityJa}の場所は入っていません**（${disasterJa}向けの登録が国土地理院のデータに無い可能性があります）。${municipalityJa}のハザードマップ・避難情報を必ず確認してください。`,
  ]
}

/** 地点の市区町村名（分からなければ null）。注記のためだけに引く。 */
async function municipalityJaAt(lon: number, lat: number): Promise<string | null> {
  const code = await municipalityCodeAt(lon, lat).catch(() => null)
  return code === null ? null : (jmaMunicipality(code)?.nameJa ?? null)
}

/**
 * その地点から逃げられる場所（災害種別に対応したものだけ）。
 * **見つからなくても黙らない**——「見つからなかった」と、市町村を確認せよ、を返す。
 */
export async function evacuationSitesAt(
  request: HazardEvacuationRequest,
  baseUrl = '',
): Promise<HazardEvacuationResponse> {
  const placeJa = request.placeJa ?? DEFAULT_PLACE_JA
  const radiusM = request.radiusM ?? EVACUATION_RADIUS_DEFAULT_M
  const top = request.top ?? EVACUATION_TOP_DEFAULT
  const { layer } = evacuationDisaster(request.disaster)
  const { features, noteJa } = await loadFeatures(layer, request.lon, request.lat, radiusM)
  const candidates = features.flatMap((feature) => {
    const candidate = toCandidate(feature, request.disaster)
    return candidate === null ? [] : [candidate]
  })
  const near = nearestFirst(request.lon, request.lat, candidates, radiusM)
  const layerKeys = meshLayerKeysFor(request.disaster)
  const [checked, municipalityJa] = await Promise.all([
    Promise.all(near.within.map((c) => withHazardCheck(c, layerKeys, baseUrl))),
    municipalityJaAt(request.lon, request.lat),
  ])
  const sites = rankEvacuationSites({ lon: request.lon, lat: request.lat }, checked, top)
  return {
    point: { lon: request.lon, lat: request.lat, placeJa },
    forDisaster: request.disaster,
    forDisasterJa: evacuationDisasterLabelJa(request.disaster),
    siteKindJa: EVACUATION_SITE_KIND_JA,
    searchRadiusM: radiusM,
    headlineJa: evacuationHeadlineJa(placeJa, request.disaster, sites, radiusM),
    sites: sites.map((site) => ({
      ...site,
      disastersJa: [...site.disastersJa],
      hazardAreaJa: hazardAreaLabelJa(site.hazardAreaCertainty),
    })),
    limitationsJa: [...EVACUATION_LIMITATIONS_JA],
    notesJa: [
      ...outOfMunicipalityNoteJa(
        municipalityJa,
        evacuationDisasterLabelJa(request.disaster),
        near.within,
      ),
      ...evacuationNotesJa(request.disaster, sites),
      ...(near.droppedCount > 0
        ? [`候補が多いため、近い ${CHECKED_CANDIDATES} 件だけを調べました（${near.droppedCount} 件は見ていません）。`]
        : []),
      ...(noteJa === null ? [] : [noteJa]),
    ],
    sources: [...SOURCES],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
}
