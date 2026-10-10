/**
 * ドメイン：エリア要約を**組み立てる**（純関数・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12）。
 *
 * 材料（`load.ts` が DB から集める）→ 共通 API の応答。エリアの種類ごとに、区域の値の作り方・無い値・内訳が違う：
 *
 * | 種類 | 区域の値 | 無い値 | 内訳 |
 * |---|---|---|---|
 * | 行政区域 | 公表値（推計は市区町村ごとの合計） | 区の再編・浜通りの推計など（`areas.missing`） | 区・市区町村・都道府県 |
 * | 沿線 | メッシュの按分 | 2025 年・1995〜2010 年の人口 | 駅（路線の順） |
 * | 駅から N m | 起点の駅の円の値（6 つの半径のどれかのとき） | 6 つ以外の半径は区域の値なし | なし |
 * | 地図の範囲 | なし（任意の範囲の合計は持たない） | 区域の値なし | なし |
 */

import { type LineStation, type StationStatRow } from '@/db/queries'
import { areaKindLabel, getAreaMetric, type AreaMetric } from '@/shared/area-catalog'
import {
  type AreaMissing,
  type AreaStationStat,
  type AreaSummary,
  type AreaSummaryResponse,
  type StationColoring,
  type StationLegend,
} from '@/shared/area-summary'
import { getEntry } from '@/shared/catalog'
import { distanceLabel, isRadiusM, radiusLabel, RADII_M, type RadiusM } from '@/shared/constants'
import { cityOfWard } from '@/shared/municipality'
import { sourcesForKeys } from '@/domain/sources'
import { adminBreakdown, lineBreakdown } from './breakdown'
import { compareAreas } from './compare'
import { AREA_NOT_INCLUDED_JA, notesFor, sourcesFor } from './notes'
import { type ResolvedArea } from './resolve'
import { stationStatOf, type ResolvedStationStat } from './stations'
import { buildTotals, type MethodOf } from './totals'

/** 沿線と駅の円で無い人口の年（メッシュの年が揃わない・2025 年は未公表）。 */
export const MESH_UNAVAILABLE_JA =
  '人口の 2025 年（国勢調査のメッシュが未公表）と 1995〜2010 年（500m のメッシュで、250m の年と比べると段差が出る）は無い。'

/** 地図の範囲の区域の値を出さない理由（§6.12.4 d・§12-24）。 */
export const BBOX_UNAVAILABLE_JA =
  '地図の範囲（任意の範囲）の区域の値は出していない（任意の範囲の合計を作るメッシュを持っていない）。駅の分布と色分けは出している。'

/** 円の面積の単位換算（m² → km²）。 */
const SQUARE_METERS_PER_KM2 = 1_000_000
/** 面積の小数の桁（行政区域の面積〔国勢調査〕と同じ 0.01 km²）。 */
const AREA_KM2_SCALE = 100

/** 駅から N m の円の面積（km²・0.01 km² に丸める）。 */
export function circleAreaKm2(radiusM: number): number {
  return (
    Math.round(((Math.PI * radiusM * radiusM) / SQUARE_METERS_PER_KM2) * AREA_KM2_SCALE) /
    AREA_KM2_SCALE
  )
}

/** 駅から N m の区域の値を出さない理由。 */
export function nearUnavailableJa(withinM: number): string {
  return `駅から ${distanceLabel(withinM)} の区域の値は出していない（出せる半径：${RADII_M.map(radiusLabel).join('・')}）。駅の分布と色分けは出している。`
}

/** 材料（`load.ts` が DB から集める）。 */
export type AreaSummaryParts = {
  readonly area: ResolvedArea
  /** エリアの駅の数と、指標ごとの分布（DB の行）。 */
  readonly stationCount: number
  readonly statRows: readonly StationStatRow[]
  /** 沿線の駅（路線の順）と、駅の円の値（grp → 駅の指標の key → 値）。沿線のときだけ。 */
  readonly line: {
    readonly stations: readonly LineStation[]
    readonly values: Readonly<Record<string, Readonly<Record<string, number>>>>
  } | null
  /** 駅から N m（6 つの半径のどれか）の、起点の駅の円の値（区域の指標の key → 値）。それ以外は null。 */
  readonly circle: ReadonlyMap<string, number> | null
}

/** 行政区域は公表値（推計は市区町村ごとの合計）・沿線はメッシュの按分。 */
const adminMethod: MethodOf = (metric) => ({
  method: metric.sources.admin.method,
  sourceJa: metric.sources.admin.sourceJa,
})
const lineMethod: MethodOf = (metric) => ({
  method: 'mesh',
  sourceJa: metric.sources.line?.sourceJa ?? '',
})

/** 駅から N m は起点の駅の円の値（出典は駅の指標のカタログ）。 */
function nearMethod(radiusM: RadiusM): MethodOf {
  return (metric) => ({
    method: 'stationRadius',
    sourceJa: getEntry(stationKeyOf(metric, radiusM))?.source ?? '',
  })
}

/** 区域の指標 → その半径の駅の指標の key（`pop_2020` → `pop_2020_1km`）。 */
export function stationKeyOf(metric: AreaMetric, radiusM: RadiusM): string {
  return `${metric.key}_${radiusLabel(radiusM)}`
}

const BASE_LABELS_JA: Readonly<Record<AreaMetric['baseMetric'], string>> = {
  pop: '人口',
  pop_pred: '将来推計人口',
  estab_n: '事業所',
  emp_n: '従業者',
}

/** 年の並び（「2012年」「1995〜2015年」）。 */
function yearsText(years: readonly number[]): string {
  const sorted = [...years].sort((a, b) => a - b)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined) return ''
  return first === last ? `${first}年` : `${first}〜${last}年`
}

/** 無い値の言い方（「人口（1995〜2015年）：2024 年 1 月の区の再編…」）。 */
export function missingText(missing: AreaMissing): string {
  const metrics = missing.keys
    .map(getAreaMetric)
    .filter((metric): metric is AreaMetric => metric !== undefined)
  const bases = [...new Set(metrics.map((metric) => metric.baseMetric))]
  const parts = bases.map((base) => {
    const years = metrics
      .filter((metric) => metric.baseMetric === base)
      .map((metric) => metric.year)
    return `${BASE_LABELS_JA[base]}（${yearsText(years)}）`
  })
  return `${parts.join('・')}：${missing.reasonJa}`
}

/** 内訳の親の名前（区 → 市・市区町村 → 都道府県・都道府県 → 全国）。 */
function parentOf(area: Extract<ResolvedArea, { type: 'admin' }>): AreaSummary['parent'] {
  const { row } = area
  if (row.parentKey === null) return null
  if (row.parentKey === 'jp') return { ref: 'jp', nameJa: '全国' }
  const nameJa =
    row.kind === 'ward' ? (cityOfWard(row.nameJa) ?? row.nameJa) : (row.prefecture ?? '')
  return { ref: row.parentKey, nameJa }
}

type AreaHead = Pick<
  AreaSummary,
  | 'ref'
  | 'kind'
  | 'kindJa'
  | 'nameJa'
  | 'labelJa'
  | 'parent'
  | 'areaKm2'
  | 'totals'
  | 'unavailableJa'
  | 'breakdown'
>

function adminHead(area: Extract<ResolvedArea, { type: 'admin' }>): AreaHead {
  return {
    ref: area.ref,
    kind: area.row.kind,
    kindJa: areaKindLabel(area.row.kind),
    nameJa: area.row.nameJa,
    labelJa: area.row.labelJa,
    parent: parentOf(area),
    areaKm2: area.row.areaKm2,
    totals: buildTotals(area.row.values, adminMethod, true),
    unavailableJa: area.row.missing.map(missingText),
    breakdown: adminBreakdown(area.row, area.children),
  }
}

function lineHead(
  area: Extract<ResolvedArea, { type: 'line' }>,
  line: AreaSummaryParts['line'],
): AreaHead {
  const width = area.row.widthM
  const breakdown =
    line === null || width === null || !isRadiusM(width)
      ? null
      : lineBreakdown(width, line.stations, line.values)
  return {
    ref: area.ref,
    kind: 'line',
    kindJa: areaKindLabel('line'),
    nameJa: area.row.nameJa,
    labelJa: area.row.labelJa,
    parent: null,
    areaKm2: area.row.areaKm2,
    totals: buildTotals(area.row.values, lineMethod, false),
    unavailableJa: [MESH_UNAVAILABLE_JA],
    breakdown,
  }
}

function nearHead(
  area: Extract<ResolvedArea, { type: 'near' }>,
  circle: AreaSummaryParts['circle'],
): AreaHead {
  const within = area.withinM
  const label = `${area.origin.label}から ${distanceLabel(within)}`
  const totals =
    circle === null || !isRadiusM(within) ? [] : buildTotals(circle, nearMethod(within), false)
  return {
    ref: area.ref,
    kind: 'near',
    kindJa: `駅から ${distanceLabel(within)} の円`,
    nameJa: label,
    labelJa: label,
    parent: null,
    areaKm2: circleAreaKm2(within),
    totals,
    unavailableJa: totals.length === 0 ? [nearUnavailableJa(within)] : [MESH_UNAVAILABLE_JA],
    breakdown: null,
  }
}

function bboxHead(area: Extract<ResolvedArea, { type: 'bbox' }>): AreaHead {
  return {
    ref: area.ref,
    kind: 'bbox',
    kindJa: '地図の範囲',
    nameJa: '地図の範囲',
    labelJa: '地図の範囲',
    parent: null,
    areaKm2: null,
    totals: [],
    unavailableJa: [BBOX_UNAVAILABLE_JA],
    breakdown: null,
  }
}

function headOf(parts: AreaSummaryParts): AreaHead {
  const { area } = parts
  switch (area.type) {
    case 'admin':
      return adminHead(area)
    case 'line':
      return lineHead(area, parts.line)
    case 'near':
      return nearHead(area, parts.circle)
    case 'bbox':
      return bboxHead(area)
  }
}

/** エリア 1 つの要約。 */
export function buildAreaSummary(
  parts: AreaSummaryParts,
  stats: readonly ResolvedStationStat[],
  radiusM: RadiusM,
): AreaSummary {
  const rows = new Map(parts.statRows.map((row) => [row.key, row]))
  // 駅の無いエリア（駅の無い町村・駅の無い範囲）は、分布を空にする（値 0 の行を並べない）。
  const statsOf = (stat: ResolvedStationStat): AreaStationStat =>
    stationStatOf(stat, rows.get(stat.entry.key), parts.stationCount, radiusM)
  return {
    ...headOf(parts),
    stationCount: parts.stationCount,
    stations: {
      count: parts.stationCount,
      radiusM,
      stats: parts.stationCount === 0 ? [] : stats.map(statsOf),
    },
  }
}

type SourceRow = { source: string; license: string }

/** 値のある区域の指標。 */
function metricsOf(values: ReadonlyMap<string, number>): AreaMetric[] {
  return [...values.keys()]
    .map(getAreaMetric)
    .filter((metric): metric is AreaMetric => metric !== undefined)
}

/** 駅から N m の出典（区域の値に使った駅の指標の出典）。 */
function nearSourcesOf(withinM: number, circle: AreaSummaryParts['circle']): SourceRow[] {
  if (circle === null || !isRadiusM(withinM)) return []
  return [...sourcesForKeys(metricsOf(circle).map((metric) => stationKeyOf(metric, withinM)))]
}

/** 区域の値の出典（行政区域・沿線はカタログ、駅から N m は駅の指標）。 */
export function areaSourcesOf(parts: AreaSummaryParts): SourceRow[] {
  const { area } = parts
  switch (area.type) {
    case 'admin':
      return metricsOf(area.row.values).map(({ sources }) => ({
        source: sources.admin.sourceJa,
        license: sources.admin.license,
      }))
    case 'line':
      return metricsOf(area.row.values).flatMap(({ sources }) =>
        sources.line === null
          ? []
          : [{ source: sources.line.sourceJa, license: sources.line.license }],
      )
    case 'near':
      return nearSourcesOf(area.withinM, parts.circle)
    case 'bbox':
      return []
  }
}

/** 地図の色分けの条件（色分けしなかった〔駅が少ないなど〕なら null——していない色分けを地図に送らない）。 */
function coloringOf(
  legend: StationLegend | null,
  summaries: readonly AreaSummary[],
): StationColoring | null {
  if (legend === null || legend.reasonJa !== null) return null
  return { metricKey: legend.metricKey, areas: summaries.map((summary) => summary.ref) }
}

/** 共通 API の応答（エリアの並びは指定どおり）。 */
export function buildAreaSummaryResponse(
  parts: readonly AreaSummaryParts[],
  stats: readonly ResolvedStationStat[],
  radiusM: RadiusM,
  legend: StationLegend | null,
): AreaSummaryResponse {
  const summaries = parts.map((each) => buildAreaSummary(each, stats, radiusM))
  return {
    areas: summaries,
    comparison: compareAreas(summaries),
    coloring: coloringOf(legend, summaries),
    legend,
    radiusM,
    notesJa: notesFor(summaries, radiusM),
    notIncludedJa: [...AREA_NOT_INCLUDED_JA],
    sources: sourcesFor(summaries, parts.flatMap(areaSourcesOf)),
  }
}
