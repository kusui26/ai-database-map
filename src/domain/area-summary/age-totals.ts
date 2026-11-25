/**
 * ドメイン：区域の値のうち**年齢**の 2 系統（純関数・2026-11-25・`docs/261122_PLAN_population_improvement.md` §8.4）。
 *
 * - 生産年齢人口（15〜64 歳）：2020 年（実績）の人数と、2050 年（推計）の人数・2020 年比の増減
 * - 高齢化率（65 歳以上の割合）：2020 年 → 2050 年（割合なので増減率は作らない）
 *
 * 系列は実績（2015・2020 年）と推計（2025〜2050 年）を年の順に並べる。行政区域の 2020 年は社人研の推計の起点と同じ値
 * （国勢調査の不詳補完値・全 1,950 区域で一致）なので、2020 → 2050 年の増減は社人研の推計の中の増減と同じになる。
 * 沿線と駅の円は、駅の年齢と同じセルの値（2020 年は国勢調査・2050 年は R6）。
 */

import {
  AREA_AGE_BASES,
  areaMetricsOf,
  isProjectedAreaMetric,
  type AreaAgeBase,
  type AreaMetric,
} from '@/shared/area-catalog'
import {
  type AreaChange,
  type AreaPoint,
  type AreaTotal,
  type AreaTotalMethod,
  type AreaYearValue,
} from '@/shared/area-summary'
import { METHOD_LABELS_JA, type MethodOf } from './method'
import { changeOf, percentJa, rateJa, valueJa } from './wording'

/** 割合の単位。 */
const PERCENT_UNIT = '%'
const WORKING_AGE_BASE: AreaAgeBase = 'pop15_64'
const ELDERLY_BASES: readonly AreaAgeBase[] = ['pop65_74', 'pop75']
const PERCENT_SCALE = 100

/** 年齢の 4 区分をまとめた名前（出せない値の言い方・区分ごとには言わない）。 */
export const AGE_LABEL_JA = '年齢別の人口'
export const WORKING_AGE_LABEL_JA = '生産年齢人口（15〜64歳）'
export const AGING_RATE_LABEL_JA = '高齢化率（65歳以上の割合）'

type AgePoint = { readonly metric: AreaMetric; readonly point: AreaPoint }

/** 系統の値のある年の点（年の古い順・推計の年は projection）。 */
function bandPoints(base: AreaAgeBase, values: ReadonlyMap<string, number>): AgePoint[] {
  return areaMetricsOf(base).flatMap((metric) => {
    const value = values.get(metric.key)
    if (value === undefined) return []
    const kind: AreaPoint['kind'] = isProjectedAreaMetric(metric) ? 'projection' : 'actual'
    return [{ metric, point: { year: metric.year, value, kind } }]
  })
}

/** その年の 4 区分の人数（1 つでも欠ければ null）。 */
function countsAt(year: number, values: ReadonlyMap<string, number>): number[] | null {
  const counts = AREA_AGE_BASES.map((base) => {
    const metric = areaMetricsOf(base).find((each) => each.year === year)
    return metric === undefined ? undefined : values.get(metric.key)
  })
  return counts.every((count): count is number => count !== undefined) ? counts : null
}

/** 高齢化率の点（4 区分がそろう年だけ・65〜74 歳＋75 歳以上 ÷ 4 区分の和 × 100）。 */
function agingPoints(
  working: readonly AgePoint[],
  values: ReadonlyMap<string, number>,
): AreaPoint[] {
  return working.flatMap(({ point }) => {
    const counts = countsAt(point.year, values)
    const total = counts?.reduce((sum, count) => sum + count, 0) ?? 0
    if (counts === null || total <= 0) return []
    const elderly = ELDERLY_BASES.reduce(
      (sum, base) => sum + (counts[AREA_AGE_BASES.indexOf(base)] ?? 0),
      0,
    )
    return [{ ...point, value: (elderly / total) * PERCENT_SCALE }]
  })
}

/** 作り方：実績（公表値）と推計が混ざれば「公表値と推計」、ほかは 1 つ（按分・駅の円）。 */
function methodOfAll(metrics: readonly AreaMetric[], methodOf: MethodOf): AreaTotalMethod {
  const methods = new Set(metrics.map((metric) => methodOf(metric).method))
  if (methods.has('official') && methods.has('projection')) return 'officialAndProjection'
  return [...methods][0] ?? 'official'
}

/** 出典（年ごとに違えば「／」でつなぐ）。 */
function sourcesOf(metrics: readonly AreaMetric[], methodOf: MethodOf): string {
  return [...new Set(metrics.map((metric) => methodOf(metric).sourceJa))].join('／')
}

/** 先に言う点（いちばん新しい実績＝2020 年。実績が無ければ最初の点）。 */
function leadOf(points: readonly AreaPoint[]): AreaPoint | undefined {
  return points.filter((point) => point.kind === 'actual').at(-1) ?? points[0]
}

/** 先に言う推計の点（将来推計人口と同じ年＝`FUTURE_LEAD_YEAR`・実績より後）。 */
function futureOf(
  points: readonly AreaPoint[],
  lead: AreaPoint,
  futureYear: number,
): AreaPoint | undefined {
  return points.find((point) => point.year === futureYear && point.year > lead.year)
}

type AgeTotalParts = {
  readonly lead: AreaYearValue
  readonly changes: AreaChange[]
  readonly headlineJa: string
}

/** 生産年齢人口：「2,388,942 人（2020年）→ 2050年 1,9xx,xxx 人（推計・2020年比 -18.3%）」。 */
function workingAgeParts(
  points: readonly AreaPoint[],
  lead: AreaPoint,
  unit: string,
  futureYear: number,
): AgeTotalParts {
  const future = futureOf(points, lead, futureYear)
  const ahead = future === undefined ? null : changeOf(lead, future)
  const before = points.filter((point) => point.kind === 'actual' && point.year < lead.year).at(-1)
  const recent = before === undefined ? null : changeOf(before, lead)
  const head = `${valueJa(lead.value, unit)}（${lead.year}年）`
  const headlineJa =
    future === undefined || ahead === null
      ? `${head}${recent === null ? '' : `・${recent.textJa}`}`
      : `${head}→ ${future.year}年 ${valueJa(future.value, unit)}（推計・${lead.year}年比 ${rateJa(ahead.rate)}）`
  const changes = [ahead, recent].filter((change): change is AreaChange => change !== null)
  return { lead: yearValue(lead, valueJa(lead.value, unit)), changes, headlineJa }
}

/** 高齢化率：「25.1%（2020年）→ 37.9%（2050年・推計）」（割合なので増減率は作らない）。 */
function agingRateParts(
  points: readonly AreaPoint[],
  lead: AreaPoint,
  futureYear: number,
): AgeTotalParts {
  const future = futureOf(points, lead, futureYear)
  const head = `${percentJa(lead.value)}（${lead.year}年）`
  const headlineJa =
    future === undefined ? head : `${head}→ ${percentJa(future.value)}（${future.year}年・推計）`
  return { lead: yearValue(lead, percentJa(lead.value)), changes: [], headlineJa }
}

function yearValue(point: AreaPoint, valueJaText: string): AreaYearValue {
  return { year: point.year, value: point.value, valueJa: valueJaText }
}

type AgeSpec = {
  readonly id: 'workingAge' | 'agingRate'
  readonly labelJa: string
  readonly unit: (metric: AreaMetric) => string
  readonly points: (
    working: readonly AgePoint[],
    values: ReadonlyMap<string, number>,
  ) => AreaPoint[]
  readonly parts: (
    points: readonly AreaPoint[],
    lead: AreaPoint,
    unit: string,
    futureYear: number,
  ) => AgeTotalParts
}

const AGE_SPECS: readonly AgeSpec[] = [
  {
    id: 'workingAge',
    labelJa: WORKING_AGE_LABEL_JA,
    unit: (metric) => metric.unit,
    points: (working) => working.map(({ point }) => point),
    parts: workingAgeParts,
  },
  {
    id: 'agingRate',
    labelJa: AGING_RATE_LABEL_JA,
    unit: () => PERCENT_UNIT,
    points: agingPoints,
    parts: (points, lead, _unit, futureYear) => agingRateParts(points, lead, futureYear),
  },
]

type AgeInputs = {
  readonly working: readonly AgePoint[]
  readonly values: ReadonlyMap<string, number>
  readonly methodOf: MethodOf
  readonly futureYear: number
}

function ageTotalOf(
  spec: AgeSpec,
  { working, values, methodOf, futureYear }: AgeInputs,
): AreaTotal | null {
  const first = working[0]
  const points = spec.points(working, values)
  const lead = leadOf(points)
  if (first === undefined || lead === undefined) return null
  const metrics = working.map(({ metric }) => metric)
  const method = methodOfAll(metrics, methodOf)
  const unit = spec.unit(first.metric)
  return {
    id: spec.id,
    labelJa: spec.labelJa,
    unit,
    method,
    methodJa: METHOD_LABELS_JA[method],
    sourceJa: sourcesOf(metrics, methodOf),
    points,
    ...spec.parts(points, lead, unit, futureYear),
    peak: null,
    accuracy: null,
  }
}

/**
 * 区域の値（区域の指標の key → 値）→ 年齢の 2 系統（生産年齢人口・高齢化率）。年齢の値の無い区域（浜松市の中央区・浜名区・
 * 年齢を入れる前の DB）は出さない。`futureYear` は将来推計人口で先に言う年（`totals.ts` の `FUTURE_LEAD_YEAR`）。
 */
export function buildAgeTotals(
  values: ReadonlyMap<string, number>,
  methodOf: MethodOf,
  futureYear: number,
): AreaTotal[] {
  const inputs: AgeInputs = {
    working: bandPoints(WORKING_AGE_BASE, values),
    values,
    methodOf,
    futureYear,
  }
  return AGE_SPECS.flatMap((spec) => {
    const total = ageTotalOf(spec, inputs)
    return total === null ? [] : [total]
  })
}
