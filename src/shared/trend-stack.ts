/**
 * 積み上げの推移チャート（`trendChart.stacked`）の読み方の規則（純関数・2026-11-25 年齢別の人口）。
 *
 * Web（Chart.js）・ビューア（SVG）・ECharts・AI の文が、**同じ年に合計を書き、同じ年から推計と読む**ように、ここ 1 か所で決める。
 * 意味（どの年から推計か・正しい合計）はパネル（protocol）が持っていて、ここは並べ方だけを決める。
 */

import { type TrendChartPanel } from './protocol'

/** x（年）の並び（全系列の和集合・昇順）。 */
export function trendXs(panel: TrendChartPanel): number[] {
  const xs = new Set(panel.series.flatMap((series) => series.points.map((point) => point.x)))
  return [...xs].sort((a, b) => a - b)
}

/** その年が推計か（`projectedFrom` 以降）。 */
export function isProjected(panel: TrendChartPanel, x: number): boolean {
  return panel.projectedFrom !== undefined && x >= panel.projectedFrom
}

/** 最初の推計の年の位置（`xs` の添字）。推計が無ければ -1。 */
export function projectedIndex(panel: TrendChartPanel, xs: readonly number[]): number {
  return xs.findIndex((x) => isProjected(panel, x))
}

/**
 * 合計の数字を書く年。推計のある図は**最後の実績の年と最後の年だけ**——8 本の全部に書くと、狭い画面で数字が重なり、
 * どれも読まれない（dataviz の「数字は選んで置く」）。間の年の合計はツールチップと AI の文にある。
 * 推計の無い図（売上の 2 時点）は、これまでどおり全部の年に書く。
 */
export function labeledTotalXs(panel: TrendChartPanel, xs: readonly number[]): ReadonlySet<number> {
  const first = projectedIndex(panel, xs)
  if (first <= 0) return new Set(xs)
  return new Set([xs[first - 1], xs.at(-1)].filter((x): x is number => x !== undefined))
}

/** 表示中の系列の、その年の和（欠損は 0 と数える）。 */
function seriesSumAt(panel: TrendChartPanel, x: number): number {
  return panel.series.reduce(
    (sum, series) => sum + (series.points.find((point) => point.x === x)?.y ?? 0),
    0,
  )
}

/**
 * その年の合計。**宣言された合計（`totals`）を優先**する——内訳の丸め和ではなく、丸める前から作った正しい値
 * （protocol の `totals`）。宣言が無い年は系列の和。
 */
export function stackTotalAt(panel: TrendChartPanel, x: number): number {
  const declared = panel.totals?.find((total) => total.x === x)?.y
  return declared === undefined || declared === null ? seriesSumAt(panel, x) : declared
}

/**
 * AI の文で言う 2 つの年（起点 → 終点）。推計のある図は**最後の実績の年 → 最後の年**（「2020年 → 2050年」）、
 * 推計の無い図は最初の年 → 最後の年。年が 1 つなら起点だけ。
 */
export function summaryXs(panel: TrendChartPanel, xs: readonly number[]): readonly number[] {
  const first = projectedIndex(panel, xs)
  const start = first > 0 ? xs[first - 1] : xs[0]
  const end = xs.at(-1)
  if (start === undefined || end === undefined) return []
  return start === end ? [start] : [start, end]
}
