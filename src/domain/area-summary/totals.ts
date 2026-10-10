/**
 * ドメイン：**区域の値**（エリア全体の人口・将来推計人口・事業所・従業者）を組み立てる（純関数・2026-10-10 B5b）。
 *
 * `docs/261001_fix_user_feedback_ui.md` §6.12.4。値は区域の種類ごとに作り方が違い、値ごとに名乗る（`method`）：
 * 行政区域は公表値（推計は R6 を市区町村ごとに足した値＝社人研の地域別推計）、沿線はメッシュの按分、
 * 駅から N m は起点の駅の円の値。**駅の値を足したものではない**。
 *
 * - 人口：最新の年の値と、その前の 5 年・さらに前の 5 年の増減（2020→2025 の減少と、2015→2020 の増加を並べて言える）
 * - 将来推計人口：2050 年の値・2020 年（推計の基準）からの増減・山・2025 年の実績との差（推計の当たり具合）。
 *   増減は**推計の中で比べる**（起点も推計の 2020 年・§12-23）
 * - 事業所・従業者（民営）：最新の年の値と、5 年・9 年の増減
 */

import { areaMetricsOf, type AreaMetric } from '@/shared/area-catalog'
import {
  type AreaAccuracy,
  type AreaChange,
  type AreaPoint,
  type AreaTotal,
  type AreaTotalId,
  type AreaTotalMethod,
  type AreaYearValue,
} from '@/shared/area-summary'
import { changeOf, rateOf, valueJa } from './wording'

/** 将来推計人口で先に言う年。 */
export const FUTURE_LEAD_YEAR = 2050
/** 推計の当たり具合を見る年（実績と推計の両方がある年）。 */
export const ACCURACY_YEAR = 2025
/** 推計と実績の差がこれ未満（%）なら「ほぼ同じ」。 */
const ACCURACY_SAME_PERCENT = 0.05

export const METHOD_LABELS_JA: Readonly<Record<AreaTotalMethod, string>> = {
  official: '公表値',
  projection: '推計（市区町村ごとの合計）',
  mesh: 'メッシュの按分',
  stationRadius: '駅の円の値（メッシュの按分）',
}

/** 区域の種類ごとの作り方と出典（行政区域・沿線はカタログ、駅から N m は駅の指標の出典）。 */
export type MethodOf = (metric: AreaMetric) => {
  readonly method: AreaTotalMethod
  readonly sourceJa: string
}

type TotalSpec = {
  readonly id: AreaTotalId
  readonly baseMetric: AreaMetric['baseMetric']
  readonly labelJa: string
}

const TOTAL_SPECS: readonly TotalSpec[] = [
  { id: 'population', baseMetric: 'pop', labelJa: '人口' },
  { id: 'populationFuture', baseMetric: 'pop_pred', labelJa: '将来推計人口' },
  { id: 'establishments', baseMetric: 'estab_n', labelJa: '事業所（民営）' },
  { id: 'employees', baseMetric: 'emp_n', labelJa: '従業者（民営）' },
]

/** 値のある年の点（年の古い順）と、使った指標。 */
function pointsOf(
  spec: TotalSpec,
  values: ReadonlyMap<string, number>,
): { readonly points: AreaPoint[]; readonly metrics: AreaMetric[] } {
  const kind: AreaPoint['kind'] = spec.baseMetric === 'pop_pred' ? 'projection' : 'actual'
  const metrics = areaMetricsOf(spec.baseMetric).filter((metric) => values.has(metric.key))
  const points = metrics.map((metric) => ({
    year: metric.year,
    value: values.get(metric.key) ?? 0,
    kind,
  }))
  return { points, metrics }
}

function yearValue(point: AreaPoint, unit: string): AreaYearValue {
  return { year: point.year, value: point.value, valueJa: valueJa(point.value, unit) }
}

function present<T>(items: readonly (T | null | undefined)[]): T[] {
  return items.filter((item): item is T => item !== null && item !== undefined)
}

/** 2 つ目に言う増減：人口はその前の区間（増加から減少に転じたかが分かる）、事業所と従業者は全期間（2012→2021）。 */
function secondChange(spec: TotalSpec, points: readonly AreaPoint[]): AreaChange | null {
  const last = points[points.length - 1]
  const before = points[points.length - 2]
  const earlier = points[points.length - 3]
  const first = points[0]
  if (spec.id === 'population') {
    return earlier === undefined || before === undefined ? null : changeOf(earlier, before)
  }
  if (first === undefined || last === undefined || points.length < 3) return null
  return changeOf(first, last)
}

/** 実績（人口・事業所・従業者）の増減：直近の区間と、2 つ目の増減。 */
function actualChanges(spec: TotalSpec, points: readonly AreaPoint[]): AreaChange[] {
  const last = points[points.length - 1]
  const before = points[points.length - 2]
  if (last === undefined || before === undefined) return []
  return present([changeOf(before, last), secondChange(spec, points)])
}

/** 推計の増減：推計の基準（2020）から 2050・2070 へ。 */
function projectionChanges(points: readonly AreaPoint[]): AreaChange[] {
  const base = points[0]
  if (base === undefined) return []
  const targets = [
    points.find((point) => point.year === FUTURE_LEAD_YEAR),
    points[points.length - 1],
  ]
  const unique = [...new Set(present(targets))].filter((point) => point.year !== base.year)
  return present(unique.map((point) => changeOf(base, point)))
}

/** 推計の当たり具合（2025 年の実績 ÷ 推計 − 1）。 */
export function accuracyOf(values: ReadonlyMap<string, number>): AreaAccuracy | null {
  const actual = values.get(`pop_${ACCURACY_YEAR}`)
  const projected = values.get(`pop_pred_2024_${ACCURACY_YEAR}`)
  if (actual === undefined || projected === undefined) return null
  const gapRate = rateOf(projected, actual)
  if (gapRate === null) return null
  const size = Math.abs(gapRate).toFixed(1)
  const textJa =
    Math.abs(gapRate) < ACCURACY_SAME_PERCENT
      ? `${ACCURACY_YEAR}年の実績は推計とほぼ同じ`
      : `${ACCURACY_YEAR}年の実績は推計より ${size}% ${gapRate < 0 ? '少ない' : '多い'}`
  return { year: ACCURACY_YEAR, projected, actual, gapRate, textJa }
}

function headlineOf(spec: TotalSpec, lead: AreaYearValue, changes: readonly AreaChange[]): string {
  const [first, second] = changes
  if (spec.id === 'populationFuture') {
    const base = first === undefined ? '' : `（推計・${first.fromYear}年比 ${first.rateJa}）`
    return `${lead.year}年 ${lead.valueJa}${base}`
  }
  const head = `${lead.valueJa}（${lead.year}年）`
  const latest = first === undefined ? '' : `・${first.textJa}`
  const previous =
    spec.id === 'population' && second !== undefined
      ? `（${second.fromYear}→${second.toYear}年は ${second.rateJa}）`
      : ''
  return `${head}${latest}${previous}`
}

/**
 * 推計の山（いちばん多い年が**途中**にあるときだけ。はじめか終わりがいちばん多い＝ずっと減る・ずっと増える系列には山が無い）。
 */
export function peakOf(points: readonly AreaPoint[], unit: string): AreaYearValue | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return null
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), first)
  return peak === first || peak === last ? null : yearValue(peak, unit)
}

/** 先に言う点（将来推計人口は 2050 年・ほかは最新の年）。 */
function leadPointOf(points: readonly AreaPoint[], isFuture: boolean): AreaPoint | undefined {
  const last = points[points.length - 1]
  return isFuture ? (points.find((point) => point.year === FUTURE_LEAD_YEAR) ?? last) : last
}

/** 出典（年ごとに違えば「／」でつなぐ・2025 年の人口は国勢調査の速報系の表）。 */
function sourcesOf(metrics: readonly AreaMetric[], methodOf: MethodOf): string {
  return [...new Set(metrics.map((metric) => methodOf(metric).sourceJa))].join('／')
}

/** 系統の名乗り（名前・単位・作り方・出典）。 */
function identityOf(
  spec: TotalSpec,
  metrics: readonly AreaMetric[],
  methodOf: MethodOf,
): Pick<AreaTotal, 'id' | 'labelJa' | 'unit' | 'method' | 'methodJa' | 'sourceJa'> | null {
  const first = metrics[0]
  if (first === undefined) return null
  const { method } = methodOf(first)
  return {
    id: spec.id,
    labelJa: spec.labelJa,
    unit: first.unit,
    method,
    methodJa: METHOD_LABELS_JA[method],
    sourceJa: sourcesOf(metrics, methodOf),
  }
}

function totalOf(
  spec: TotalSpec,
  values: ReadonlyMap<string, number>,
  methodOf: MethodOf,
  withAccuracy: boolean,
): AreaTotal | null {
  const { points, metrics } = pointsOf(spec, values)
  const identity = identityOf(spec, metrics, methodOf)
  const isFuture = spec.id === 'populationFuture'
  const leadPoint = leadPointOf(points, isFuture)
  if (identity === null || leadPoint === undefined) return null
  const lead = yearValue(leadPoint, identity.unit)
  const changes = isFuture ? projectionChanges(points) : actualChanges(spec, points)
  return {
    ...identity,
    points,
    lead,
    changes,
    peak: isFuture ? peakOf(points, identity.unit) : null,
    accuracy: isFuture && withAccuracy ? accuracyOf(values) : null,
    headlineJa: headlineOf(spec, lead, changes),
  }
}

/**
 * 区域の値（区域の指標の key → 値）→ 区域の値の 4 系統（値の無い系統は出さない）。
 * `withAccuracy` は行政区域だけ（推計の当たり具合は、実績の 2025 年がある区域だけで言える）。
 */
export function buildTotals(
  values: ReadonlyMap<string, number>,
  methodOf: MethodOf,
  withAccuracy: boolean,
): AreaTotal[] {
  return present(TOTAL_SPECS.map((spec) => totalOf(spec, values, methodOf, withAccuracy)))
}
