/**
 * ドメイン：2〜4 つのエリアを**比べる**（純関数・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.5）。
 *
 * - 年は**全員にそろう年**で比べる（沿線・駅から N m が入ると、人口の実績は 2020 年まで）
 * - 推移は 2020 年を 100 とした指数で重ねる（大きさの違うエリアの伸び方を比べる）。実績は実績の 2020 年、
 *   推計は推計の 2020 年を 100 にする（推計は推計の中で比べる・§12-23）
 * - 種類の違うエリア（横浜市と東横線の沿線）も並べてよいが、作り方（公表値・按分）を行で書く
 */

import {
  type AreaComparison,
  type AreaPoint,
  type AreaSummary,
  type AreaTotal,
  type AreaTotalId,
} from '@/shared/area-summary'
import { formatNumber, MISSING } from '@/shared/format'
import { FUTURE_LEAD_YEAR } from './totals'
import { rateJa, rateOf, valueJa } from './wording'

/** 指数の基準の年。 */
export const INDEX_BASE_YEAR = 2020

function totalOf(summary: AreaSummary, id: AreaTotalId): AreaTotal | undefined {
  return summary.totals.find((total) => total.id === id)
}

/** 人口の実績がある全エリアにそろう年（古い順）。 */
function commonPopulationYears(summaries: readonly AreaSummary[]): number[] {
  const yearSets = summaries
    .map((summary) => totalOf(summary, 'population'))
    .filter((total): total is AreaTotal => total !== undefined)
    .map((total) => new Set(total.points.map((point) => point.year)))
  const [first, ...rest] = yearSets
  if (first === undefined) return []
  return [...first].filter((year) => rest.every((set) => set.has(year))).sort((a, b) => a - b)
}

function pointAt(total: AreaTotal | undefined, year: number): AreaPoint | undefined {
  return total?.points.find((point) => point.year === year)
}

function valueCell(total: AreaTotal | undefined, year: number): string {
  const point = pointAt(total, year)
  return point === undefined || total === undefined ? MISSING : valueJa(point.value, total.unit)
}

/** 先に言う値と年（「1,527,783 人（2021年）」）。 */
function leadCell(total: AreaTotal | undefined): string {
  return total === undefined ? MISSING : `${total.lead.valueJa}（${total.lead.year}年）`
}

function changeCell(total: AreaTotal | undefined, from: number, to: number): string {
  const start = pointAt(total, from)
  const end = pointAt(total, to)
  const rate = start === undefined || end === undefined ? null : rateOf(start.value, end.value)
  return rate === null ? MISSING : rateJa(rate)
}

/** 1 エリアの指数の系列（実績は実績の 2020、推計は推計の 2020 を 100）。基準が無ければ空。 */
function indexPoints(summary: AreaSummary, years: readonly number[]): AreaPoint[] {
  const actual = totalOf(summary, 'population')
  const future = totalOf(summary, 'populationFuture')
  const actualBase = pointAt(actual, INDEX_BASE_YEAR)?.value
  const futureBase = pointAt(future, INDEX_BASE_YEAR)?.value
  const scaled = (points: readonly AreaPoint[], base: number | undefined): AreaPoint[] =>
    base === undefined || base <= 0
      ? []
      : points.map((point) => ({ ...point, value: (point.value / base) * 100 }))
  const actualPoints = (actual?.points ?? []).filter((point) => years.includes(point.year))
  return [...scaled(actualPoints, actualBase), ...scaled(future?.points ?? [], futureBase)]
}

type Row = AreaComparison['rows'][number]

/** 1 行（エリアごとのセル）。 */
function rowOf(
  summaries: readonly AreaSummary[],
  labelJa: string,
  cell: (summary: AreaSummary) => string,
): Row {
  return { labelJa, cells: summaries.map(cell) }
}

/** 人口（そろう年の最新）と、その前の 5 年の増減。 */
function populationRows(summaries: readonly AreaSummary[], years: readonly number[]): Row[] {
  const latest = years[years.length - 1]
  const previous = years[years.length - 2]
  if (latest === undefined) return []
  const population = (summary: AreaSummary): AreaTotal | undefined => totalOf(summary, 'population')
  const level = rowOf(summaries, `人口（${latest}年）`, (s) => valueCell(population(s), latest))
  if (previous === undefined) return [level]
  const change = rowOf(summaries, `人口の増減（${previous}→${latest}年）`, (s) =>
    changeCell(population(s), previous, latest),
  )
  return [level, change]
}

/** 将来推計人口（2050 年）と、推計の 2020 年からの増減。 */
function futureRows(summaries: readonly AreaSummary[]): Row[] {
  const future = (summary: AreaSummary): AreaTotal | undefined =>
    totalOf(summary, 'populationFuture')
  return [
    rowOf(summaries, `将来推計人口（${FUTURE_LEAD_YEAR}年）`, (s) =>
      valueCell(future(s), FUTURE_LEAD_YEAR),
    ),
    rowOf(summaries, `将来の増減（${INDEX_BASE_YEAR}→${FUTURE_LEAD_YEAR}年・推計）`, (s) =>
      changeCell(future(s), INDEX_BASE_YEAR, FUTURE_LEAD_YEAR),
    ),
  ]
}

/** 従業者・駅の数・区域の値の作り方。 */
function otherRows(summaries: readonly AreaSummary[]): Row[] {
  return [
    rowOf(summaries, '従業者（民営）', (s) => leadCell(totalOf(s, 'employees'))),
    rowOf(summaries, '駅の数', (s) => `${formatNumber(s.stationCount, 'int')} 駅`),
    rowOf(
      summaries,
      '区域の値の作り方',
      (s) => totalOf(s, 'population')?.methodJa ?? 'なし（駅の分布だけ）',
    ),
  ]
}

/** 比べ方の注記（年をそろえて切った・指数の読み方・作り方が混ざる）。 */
function comparisonNotes(summaries: readonly AreaSummary[], years: readonly number[]): string[] {
  const latestCommon = years[years.length - 1]
  const availableYears = summaries.flatMap((s) =>
    (totalOf(s, 'population')?.points ?? []).map((point) => point.year),
  )
  const trimmed = latestCommon !== undefined && availableYears.some((year) => year > latestCommon)
  const methods = new Set(summaries.map((s) => totalOf(s, 'population')?.method ?? 'none'))
  return [
    trimmed
      ? `人口は全員にそろう年（${latestCommon}年まで）で比べた（沿線・駅の円の値は 2020 年まで）。`
      : null,
    `推移は ${INDEX_BASE_YEAR}年を 100 とした指数（実績は実績の ${INDEX_BASE_YEAR}年、推計は推計の ${INDEX_BASE_YEAR}年を 100）。`,
    methods.size > 1 ? '区域の値の作り方がエリアで違う（行の「区域の値の作り方」）。' : null,
  ].filter((note): note is string => note !== null)
}

/** 2 つ以上のエリアの比較（1 つなら null）。 */
export function compareAreas(summaries: readonly AreaSummary[]): AreaComparison | null {
  if (summaries.length < 2) return null
  const years = commonPopulationYears(summaries)
  return {
    refs: summaries.map((s) => s.ref),
    names: summaries.map((s) => s.labelJa),
    rows: [...populationRows(summaries, years), ...futureRows(summaries), ...otherRows(summaries)],
    baseYear: INDEX_BASE_YEAR,
    index: summaries.map((s) => ({ ref: s.ref, nameJa: s.labelJa, points: indexPoints(s, years) })),
    notesJa: comparisonNotes(summaries, years),
  }
}
