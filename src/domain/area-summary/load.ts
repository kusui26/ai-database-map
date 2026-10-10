/**
 * ドメイン：エリア要約を**一続きで**作る（解決 → 取得 → 組み立て・2026-10-10 B5b）。
 *
 * このファイルは非純粋（DB を読む）。共通 API（`/api/areas/summary`）と AI のツール（B5d `getAreaSummary`）はここを 1 回
 * 呼ぶだけでよい——順番と往復を呼び出し側に持たせると、画面とチャットで別の答えになりうる（B4 と同じ）。
 *
 * 往復：区域の行（内訳の子つき）1 回 →（エリアごとに）駅の分布 1 回・沿線なら路線の駅と駅の円の値・駅から N m なら起点の円の値、
 * と色分けの値（エリアごと）を並列に。
 */

import {
  areaStationStats,
  datasetRows,
  lineStationsInOrder,
  stationBundle,
  type StationStatRow,
} from '@/db/queries'
import { areaCatalog } from '@/shared/area-catalog'
import { type AreaSummaryResponse } from '@/shared/area-summary'
import { type CatalogEntry } from '@/shared/catalog'
import { isRadiusM, type RadiusM } from '@/shared/constants'
import {
  classifyAreas,
  colorableEntry,
  defaultColorEntry,
  notColorableJa,
} from '@/domain/style/load'
import { lineBreakdownEntries } from './breakdown'
import { buildAreaSummaryResponse, stationKeyOf, type AreaSummaryParts } from './build'
import { parseAreaRefs } from './refs'
import { resolveAreas, stationFilterOf, type ResolvedArea } from './resolve'
import { resolveStationStats } from './stations'

/** 色分けを付けない指定（`colorBy=none`）。 */
export const NO_COLORING = 'none'

export type AreaSummaryRequest = {
  readonly areas: readonly string[]
  readonly radiusM: RadiusM
  /** 色分けの指標の key（省略＝人口の増減 5 年・`none`＝色分けしない）。 */
  readonly colorBy: string | undefined
}

export type AreaSummaryResult =
  | { readonly ok: true; readonly response: AreaSummaryResponse }
  | { readonly ok: false; readonly messageJa: string }

type ColorChoice =
  | { readonly ok: true; readonly entry: CatalogEntry | null }
  | { readonly ok: false; readonly messageJa: string }

function colorChoiceOf(colorBy: string | undefined, radiusM: RadiusM): ColorChoice {
  if (colorBy === undefined) return { ok: true, entry: defaultColorEntry(radiusM) }
  if (colorBy === NO_COLORING) return { ok: true, entry: null }
  const entry = colorableEntry(colorBy)
  return entry === null ? { ok: false, messageJa: notColorableJa(colorBy) } : { ok: true, entry }
}

/**
 * 沿線の駅（路線の順）と、内訳に使う駅の円の値（2km までの人口と、小数 1 桁の増減率）。`dataset_rows` の有効 6 桁で足りる
 * （駅から 2km の人口は多くて 30 万人台）——100 万を超える円の値は `circleParts` のとおり `station_bundle` で引く。
 */
async function lineParts(
  area: Extract<ResolvedArea, { type: 'line' }>,
): Promise<AreaSummaryParts['line']> {
  const width = area.row.widthM
  if (area.row.lineCd === null || width === null || !isRadiusM(width)) return null
  const stations = await lineStationsInOrder(area.row.lineCd)
  const entries = Object.values(lineBreakdownEntries(width)).filter(
    (entry): entry is CatalogEntry => entry !== null,
  )
  const values = await datasetRows(
    stations.map((station) => station.grp),
    entries.map((entry) => entry.key),
  )
  return { stations, values }
}

/**
 * 駅から N m（6 つの半径のどれか）の、起点の駅の円の値（区域の指標の key へ読み替える・年は沿線と同じ）。
 * 駅詳細と同じ `station_bundle` で引く——`dataset_rows`（jsonb）は PostgREST の接続の設定で real が有効 6 桁に丸まり、
 * 5km 以上の円の値（100 万人を超える）が駅詳細とずれる（1,163,836 → 1,163,840）。
 */
async function circleParts(
  area: Extract<ResolvedArea, { type: 'near' }>,
): Promise<AreaSummaryParts['circle']> {
  const within = area.withinM
  if (!isRadiusM(within)) return null
  const bundle = await stationBundle(area.origin.grp)
  const values = areaCatalog.metrics.flatMap((metric): [string, number][] => {
    const value =
      metric.sources.line === null ? undefined : bundle.get(stationKeyOf(metric, within))
    return value === undefined ? [] : [[metric.key, value]]
  })
  return values.length === 0 ? null : new Map(values)
}

async function partsOf(area: ResolvedArea, statKeys: readonly string[]): Promise<AreaSummaryParts> {
  const [stats, line, circle] = await Promise.all([
    areaStationStats(statKeys, stationFilterOf(area)),
    area.type === 'line' ? lineParts(area) : Promise.resolve(null),
    area.type === 'near' ? circleParts(area) : Promise.resolve(null),
  ])
  const statRows: readonly StationStatRow[] = stats.stats
  return { area, stationCount: stats.stationCount, statRows, line, circle }
}

/** 共通 API のエリア要約：エリアの文字列（1〜4）・半径・色分けの指標 → 要約（知らないエリアなどは理由）。 */
export async function loadAreaSummary(request: AreaSummaryRequest): Promise<AreaSummaryResult> {
  const parsed = parseAreaRefs(request.areas)
  if (!parsed.ok) return parsed
  const color = colorChoiceOf(request.colorBy, request.radiusM)
  if (!color.ok) return color
  const resolved = await resolveAreas(parsed.refs, { withChildren: true, requireLineWidth: true })
  if (!resolved.ok) return resolved
  const stats = resolveStationStats(request.radiusM, color.entry)
  const statKeys = stats.map((stat) => stat.entry.key)
  const [parts, classification] = await Promise.all([
    Promise.all(resolved.areas.map((area) => partsOf(area, statKeys))),
    color.entry === null ? Promise.resolve(null) : classifyAreas(color.entry, resolved.areas),
  ])
  const legend = classification === null ? null : classification.legend
  return { ok: true, response: buildAreaSummaryResponse(parts, stats, request.radiusM, legend) }
}
