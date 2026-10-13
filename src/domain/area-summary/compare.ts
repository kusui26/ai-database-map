/**
 * ドメイン：2〜4 つのエリアを**比べる**（純関数・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.5）。
 *
 * - 年は**全員にそろう年**で比べる（沿線・駅から N m が入ると、人口の実績は 2020 年まで）
 * - 推移は 2020 年を 100 とした指数で重ねる（大きさの違うエリアの伸び方を比べる）。実績は実績の 2020 年、
 *   推計は推計の 2020 年を 100 にする（推計は推計の中で比べる・§12-23）
 * - 種類の違うエリア（横浜市と東横線の沿線）も並べてよいが、作り方（公表値・按分）を行で書く
 * - 片方がもう片方に入っているとき（区と市・市と県）は、人口・推計・従業者の行のすぐ下に**占める割合**の行を足す
 *   （いちばん近い入れ物に対して・`share.ts`・2026-10-13 B5d″）。入れ物のあるエリアが無ければ行を出さない
 */

import {
  type AreaComparison,
  type AreaPoint,
  type AreaSummary,
  type AreaTotal,
  type AreaTotalId,
} from '@/shared/area-summary'
import { formatNumber, MISSING } from '@/shared/format'
import { shareJa } from './share'
import { FUTURE_LEAD_YEAR } from './totals'
import { rateJa, rateOf, valueJa } from './wording'

/** 指数の基準の年。 */
export const INDEX_BASE_YEAR = 2020

/** 比べるエリアの入れ物（エリアの文字列 → いちばん近い入れ物のエリアの文字列・`share.ts` の `nearestContainers`）。 */
export type Containers = ReadonlyMap<string, string>

const NO_CONTAINERS: Containers = new Map()

/** 占める割合の行があるときの注記。 */
const SHARE_NOTE_JA =
  '占める割合は、比べるエリアのうち入っているいちばん近いエリアに対する割合（区は市、市は県、県は全国）。'

function totalOf(summary: AreaSummary, id: AreaTotalId): AreaTotal | undefined {
  return summary.totals.find((total) => total.id === id)
}

/** その値がある全エリアにそろう年（古い順・値の無いエリアは数えない）。 */
function commonYears(summaries: readonly AreaSummary[], id: AreaTotalId): number[] {
  const yearSets = summaries
    .map((summary) => totalOf(summary, id))
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

/** その年の値（無ければ undefined）。 */
function valueAt(summary: AreaSummary, id: AreaTotalId, year: number): number | undefined {
  return pointAt(totalOf(summary, id), year)?.value
}

/** 1 つのセルの占める割合（「神奈川県の 40.8%」・入れ物か値が無ければ「—」）。 */
function shareCell(
  summary: AreaSummary,
  container: AreaSummary | undefined,
  value: (each: AreaSummary) => number | undefined,
): string {
  const part = value(summary)
  const whole = container === undefined ? undefined : value(container)
  if (container === undefined || part === undefined || whole === undefined) return MISSING
  return shareJa(part, whole, container.nameJa) ?? MISSING
}

/** 値の行のすぐ下に置く占める割合の行（入れ物のあるエリアが無ければ置かない）。 */
function shareRows(
  summaries: readonly AreaSummary[],
  containers: Containers,
  labelJa: string,
  value: (each: AreaSummary) => number | undefined,
): Row[] {
  if (!summaries.some((summary) => containers.has(summary.ref))) return []
  const byRef = new Map(summaries.map((summary) => [summary.ref, summary]))
  const containerOf = (summary: AreaSummary): AreaSummary | undefined =>
    byRef.get(containers.get(summary.ref) ?? '')
  return [rowOf(summaries, labelJa, (s) => shareCell(s, containerOf(s), value))]
}

/** 人口（そろう年の最新）と占める割合、その前の 5 年の増減。 */
function populationRows(
  summaries: readonly AreaSummary[],
  years: readonly number[],
  containers: Containers,
): Row[] {
  const latest = years[years.length - 1]
  const previous = years[years.length - 2]
  if (latest === undefined) return []
  const population = (summary: AreaSummary): AreaTotal | undefined => totalOf(summary, 'population')
  const level = rowOf(summaries, `人口（${latest}年）`, (s) => valueCell(population(s), latest))
  const share = shareRows(summaries, containers, `人口の占める割合（${latest}年）`, (s) =>
    valueAt(s, 'population', latest),
  )
  if (previous === undefined) return [level, ...share]
  const change = rowOf(summaries, `人口の増減（${previous}→${latest}年）`, (s) =>
    changeCell(population(s), previous, latest),
  )
  return [level, ...share, change]
}

/** 将来推計人口（2050 年）と占める割合、推計の 2020 年からの増減。 */
function futureRows(summaries: readonly AreaSummary[], containers: Containers): Row[] {
  const future = (summary: AreaSummary): AreaTotal | undefined =>
    totalOf(summary, 'populationFuture')
  return [
    rowOf(summaries, `将来推計人口（${FUTURE_LEAD_YEAR}年）`, (s) =>
      valueCell(future(s), FUTURE_LEAD_YEAR),
    ),
    ...shareRows(summaries, containers, `将来推計人口の占める割合（${FUTURE_LEAD_YEAR}年）`, (s) =>
      valueAt(s, 'populationFuture', FUTURE_LEAD_YEAR),
    ),
    rowOf(summaries, `将来の増減（${INDEX_BASE_YEAR}→${FUTURE_LEAD_YEAR}年・推計）`, (s) =>
      changeCell(future(s), INDEX_BASE_YEAR, FUTURE_LEAD_YEAR),
    ),
  ]
}

/** 従業者の占める割合（割合に加わるエリアにそろう最新の年・そろわなければ置かない）。 */
function employeeShareRows(summaries: readonly AreaSummary[], containers: Containers): Row[] {
  const refs = new Set([...containers.keys(), ...containers.values()])
  const years = commonYears(
    summaries.filter((summary) => refs.has(summary.ref)),
    'employees',
  )
  const latest = years[years.length - 1]
  if (latest === undefined) return []
  return shareRows(summaries, containers, `従業者の占める割合（${latest}年）`, (s) =>
    valueAt(s, 'employees', latest),
  )
}

/** 従業者と占める割合・駅の数・区域の値の作り方。 */
function otherRows(summaries: readonly AreaSummary[], containers: Containers): Row[] {
  return [
    rowOf(summaries, '従業者（民営）', (s) => leadCell(totalOf(s, 'employees'))),
    ...employeeShareRows(summaries, containers),
    rowOf(summaries, '駅の数', (s) => `${formatNumber(s.stationCount, 'int')} 駅`),
    rowOf(
      summaries,
      '区域の値の作り方',
      (s) => totalOf(s, 'population')?.methodJa ?? 'なし（駅の分布だけ）',
    ),
  ]
}

/** 比べ方の注記（年をそろえて切った・指数の読み方・作り方が混ざる・占める割合）。 */
function comparisonNotes(
  summaries: readonly AreaSummary[],
  years: readonly number[],
  shared: boolean,
): string[] {
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
    shared ? SHARE_NOTE_JA : null,
  ].filter((note): note is string => note !== null)
}

/** 2 つ以上のエリアの比較（1 つなら null）。`containers` は占める割合の入れ物（無ければ割合の行を出さない）。 */
export function compareAreas(
  summaries: readonly AreaSummary[],
  containers: Containers = NO_CONTAINERS,
): AreaComparison | null {
  if (summaries.length < 2) return null
  const years = commonYears(summaries, 'population')
  // 入れ物があれば、将来推計人口の割合の行は必ず出る（値が無ければ「—」）——その注記を付ける
  const shared = summaries.some((summary) => containers.has(summary.ref))
  return {
    refs: summaries.map((s) => s.ref),
    names: summaries.map((s) => s.labelJa),
    rows: [
      ...populationRows(summaries, years, containers),
      ...futureRows(summaries, containers),
      ...otherRows(summaries, containers),
    ],
    baseYear: INDEX_BASE_YEAR,
    index: summaries.map((s) => ({ ref: s.ref, nameJa: s.labelJa, points: indexPoints(s, years) })),
    notesJa: comparisonNotes(summaries, years, shared),
  }
}
