/**
 * ドメイン：エリアの要約 → GUI Chat Protocol のパネル（純関数・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.9
 * 「パネルは areaSummary・推移・内訳の 3 つまで」）。
 *
 * - `areaSummary`：区域の値の見出しと作り方・無い値・駅の分布・比べる表・色分けの凡例・注記・見ていないこと・出典
 * - `trendChart`（推移）：1 つなら人口の実績（実線）と推計（破線）、2 つ以上なら 2020 年＝100 の指数（エリアごとの色・凡例つき）
 * - `barChart`（内訳）：エリアが 1 つのときの、区・市区町村・都道府県（沿線は駅）ごとの人口の増減
 *
 * チャットの回答（会話・MCP）とエリアの図（B5e）が同じパネルを描く。意味づけは `build.ts` が済ませていて、
 * ここで足すのは見出しと並べ方だけ。
 */

import { CATEGORY_COLORS } from '@/shared/constants'
import {
  type AreaBreakdown,
  type AreaBreakdownRow,
  type AreaComparison,
  type AreaComparisonTable,
  type AreaPoint,
  type AreaSummary,
  type AreaSummaryCard,
  type AreaSummaryResponse,
  type AreaTotal,
  type AreaTotalLine,
} from '@/shared/area-summary'
import {
  type AreaSummaryPanel,
  type Bar,
  type BarChartPanel,
  type Panel,
  type PanelSize,
  type PanelStat,
  type SourceRef,
  type TrendChartPanel,
  type TrendSeries,
} from '@/shared/protocol'
import { areaSeriesColor } from '@/domain/style/palette'

/** 内訳の棒をすべて出す上限（これを超えたら、増減の大きい順の上位と下位だけ）。 */
export const MAX_BREAKDOWN_BARS = 30
/** 上限を超えたときに出す、上位と下位それぞれの数。 */
export const BREAKDOWN_EDGE_BARS = 10

/** 見出し（1 つ＝「神奈川県横浜市の要約」・2 つ以上＝「横浜市・川崎市の比較」）。 */
export function areaSummaryTitleOf(response: AreaSummaryResponse): string {
  if (response.areas.length === 1) return `${response.areas[0]?.labelJa ?? ''}の要約`
  return `${response.areas.map((area) => area.nameJa).join('・')}の比較`
}

/** 区域の値 → パネルの行（年ごとの値は推移の図に回す）。 */
function totalLineOf(total: AreaTotal): AreaTotalLine {
  return {
    id: total.id,
    labelJa: total.labelJa,
    unit: total.unit,
    method: total.method,
    methodJa: total.methodJa,
    sourceJa: total.sourceJa,
    lead: total.lead,
    changes: total.changes,
    peak: total.peak,
    accuracy: total.accuracy,
    headlineJa: total.headlineJa,
  }
}

/** エリア 1 つ → パネルのカード（内訳の行は内訳の図に回す）。 */
function cardOf(summary: AreaSummary): AreaSummaryCard {
  return {
    ref: summary.ref,
    kind: summary.kind,
    kindJa: summary.kindJa,
    nameJa: summary.nameJa,
    labelJa: summary.labelJa,
    parent: summary.parent,
    areaKm2: summary.areaKm2,
    stationCount: summary.stationCount,
    totals: summary.totals.map(totalLineOf),
    unavailableJa: summary.unavailableJa,
    stations: summary.stations,
  }
}

/** 比べる表（指数の系列は推移の図に回す）。 */
function comparisonTableOf(comparison: AreaComparison | null): AreaComparisonTable | null {
  if (comparison === null) return null
  const { refs, names, rows, baseYear, notesJa } = comparison
  return { refs, names, rows, baseYear, notesJa }
}

/** 出典 → protocol の出典（リンクは持たない・同じ表記は描く側が畳む）。 */
function sourceRefsOf(response: AreaSummaryResponse): SourceRef[] {
  return response.sources.map((each) => ({
    labelJa: each.source,
    url: null,
    license: each.license,
    forJa: null,
  }))
}

/** 要約のパネル（チャットは compact、図は full）。 */
export function areaSummaryPanel(
  response: AreaSummaryResponse,
  size: PanelSize = 'full',
): AreaSummaryPanel {
  return {
    type: 'areaSummary',
    title: areaSummaryTitleOf(response),
    areas: response.areas.map(cardOf),
    comparison: comparisonTableOf(response.comparison),
    legend: response.legend,
    radiusM: response.radiusM,
    notesJa: response.notesJa,
    notIncludedJa: response.notIncludedJa,
    sources: sourceRefsOf(response),
    size,
  }
}

// --- 推移 -----------------------------------------------------------------------------------

const toXY = (points: readonly AreaPoint[]): TrendSeries['points'] =>
  points.map((point) => ({ x: point.year, y: point.value }))

function totalOf(summary: AreaSummary, id: AreaTotal['id']): AreaTotal | undefined {
  return summary.totals.find((total) => total.id === id)
}

/** 増減の要約（「2020→2025年 -0.7%」「2020→2050年（推計）-6.4%」）。 */
function changeStats(actual: AreaTotal | undefined, future: AreaTotal | undefined): PanelStat[] {
  const recent = actual?.changes[0]
  const ahead = future?.changes[0]
  return [
    ...(recent === undefined
      ? []
      : [{ label: `${recent.fromYear}→${recent.toYear}年`, value: recent.rateJa, flagged: false }]),
    ...(ahead === undefined
      ? []
      : [
          {
            label: `${ahead.fromYear}→${ahead.toYear}年（推計）`,
            value: ahead.rateJa,
            flagged: false,
          },
        ]),
  ]
}

/** 人口の系列（実績＝実線・推計＝破線・同じ色）。 */
function populationSeries(
  actual: AreaTotal | undefined,
  future: AreaTotal | undefined,
): TrendSeries[] {
  const color = CATEGORY_COLORS.population
  return [
    ...(actual === undefined ? [] : [{ label: '実績', points: toXY(actual.points), color }]),
    ...(future === undefined
      ? []
      : [{ label: 'R6推計', points: toXY(future.points), color, dashed: true }]),
  ]
}

/** エリア 1 つの人口の推移（実績＝実線・推計＝破線・同じ色。駅詳細の人口の図と同じ描き方）。点が 2 つ未満なら null。 */
export function populationTrendPanel(
  summary: AreaSummary,
  size: PanelSize,
): TrendChartPanel | null {
  const actual = totalOf(summary, 'population')
  const future = totalOf(summary, 'populationFuture')
  const series = populationSeries(actual, future)
  if (series.reduce((count, each) => count + each.points.length, 0) < 2) return null
  return {
    type: 'trendChart',
    title: `${summary.labelJa}の人口の推移（実績・将来推計）`,
    unit: '人',
    format: 'int',
    category: 'population',
    flags: [],
    series,
    stats: changeStats(actual, future),
    size,
  }
}

/** 1 エリアの指数の系列（実績＝実線・推計＝同じ色の破線）。 */
function indexSeriesOf(each: AreaComparison['index'][number], index: number): TrendSeries[] {
  const color = areaSeriesColor(index)
  const actual = each.points.filter((point) => point.kind === 'actual')
  const projected = each.points.filter((point) => point.kind === 'projection')
  return [
    ...(actual.length === 0 ? [] : [{ label: each.nameJa, points: toXY(actual), color }]),
    ...(projected.length === 0
      ? []
      : [{ label: `${each.nameJa}（推計）`, points: toXY(projected), color, dashed: true }]),
  ]
}

/** エリアを比べる推移（2020 年＝100 の指数・エリアごとの色・凡例つき）。系列が無ければ null。 */
export function indexTrendPanel(
  comparison: AreaComparison,
  size: PanelSize,
): TrendChartPanel | null {
  const series = comparison.index.flatMap(indexSeriesOf)
  if (series.length === 0) return null
  return {
    type: 'trendChart',
    title: `人口の推移（${comparison.baseYear}年＝100）`,
    unit: null,
    format: 'decimal1',
    // 指数の読み方（実績は実績の 2020 年、推計は推計の 2020 年を 100）は要約のパネルの注記が言う
    // （信頼性フラグに載せると、ビューアと ECharts が ⚠ を付けて出す）。
    flags: [],
    series,
    legend: true,
    size,
  }
}

// --- 内訳 -----------------------------------------------------------------------------------

/** 内訳の行を棒にする数に絞る（多ければ増減の大きい順の上位と下位・増減の無い行は外す）。 */
export function breakdownBarRows(rows: readonly AreaBreakdownRow[]): {
  readonly rows: readonly AreaBreakdownRow[]
  readonly trimmed: boolean
} {
  if (rows.length <= MAX_BREAKDOWN_BARS) return { rows, trimmed: false }
  const ranked = rows
    .filter((row) => row.change !== null)
    .sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
  if (ranked.length <= BREAKDOWN_EDGE_BARS * 2) return { rows: ranked, trimmed: true }
  return {
    rows: [...ranked.slice(0, BREAKDOWN_EDGE_BARS), ...ranked.slice(-BREAKDOWN_EDGE_BARS)],
    trimmed: true,
  }
}

function barOf(row: AreaBreakdownRow): Bar {
  return { label: row.nameJa, value: row.change, formatted: row.changeJa, flagged: false }
}

function breakdownNote(breakdown: AreaBreakdown, total: number, trimmed: boolean): string | null {
  const parts = [
    trimmed
      ? `全 ${total} のうち、増減の大きい ${BREAKDOWN_EDGE_BARS} と小さい ${BREAKDOWN_EDGE_BARS}。`
      : null,
    breakdown.noteJa,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join('')
}

/** エリア 1 つの内訳（区・市区町村・都道府県・沿線の駅ごとの人口の増減）。内訳が無ければ null。 */
export function breakdownPanel(summary: AreaSummary, size: PanelSize): BarChartPanel | null {
  const breakdown = summary.breakdown
  if (breakdown === null || breakdown.rows.length === 0) return null
  const { rows, trimmed } = breakdownBarRows(breakdown.rows)
  return {
    type: 'barChart',
    title: `${summary.nameJa}の${breakdown.byJa}ごとの人口の${breakdown.changeLabelJa}`,
    unit: '%',
    format: 'percent1',
    category: 'population',
    bars: rows.map(barOf),
    flags: [],
    note: breakdownNote(breakdown, breakdown.rows.length, trimmed),
    size,
  }
}

/** エリアが 1 つなら、そのエリア（比較なら null）。 */
function singleArea(response: AreaSummaryResponse): AreaSummary | null {
  return response.areas.length === 1 ? (response.areas[0] ?? null) : null
}

/** 推移の図（1 つなら人口の実績と推計、比較なら指数）。 */
function trendOf(response: AreaSummaryResponse, size: PanelSize): TrendChartPanel | null {
  const single = singleArea(response)
  if (single !== null) return populationTrendPanel(single, size)
  return response.comparison === null ? null : indexTrendPanel(response.comparison, size)
}

/** 要約 → パネル（要約・推移・内訳の 3 つまで。内訳はエリアが 1 つのときだけ）。 */
export function areaSummaryPanels(
  response: AreaSummaryResponse,
  size: PanelSize = 'full',
): Panel[] {
  const single = singleArea(response)
  const panels: (Panel | null)[] = [
    areaSummaryPanel(response, size),
    trendOf(response, size),
    single === null ? null : breakdownPanel(single, size),
  ]
  return panels.filter((panel): panel is Panel => panel !== null)
}
