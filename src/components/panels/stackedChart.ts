/**
 * 積み上げ縦棒（`trendChart.stacked`）の合計とツールチップの文（純関数・2026-11-25）。
 *
 * Chart.js の描画（`TrendChart.tsx`）から切り出した。canvas に描く文は画面から読めないので、ここで単体テストする
 * （`tests/stacked-chart.test.ts`）。Chart.js の型の全部は要らないので、使う部分だけの形（`StackChart`）で受ける。
 */

import { type TrendChartPanel } from '@/shared/protocol'
import { formatNumber, formatWithUnit } from '@/shared/format'
import { isProjected, stackTotalAt } from '@/shared/trend-stack'

/** 合計を数えるのに要る Chart の部分（本物の `Chart` はこの形を満たす）。 */
export type StackChart = {
  readonly data: { readonly datasets: readonly { readonly data: readonly unknown[] }[] }
  isDatasetVisible(index: number): boolean
}

/** ツールチップ 1 項目のうち、ここで使う部分（本物の `TooltipItem<'bar'>` はこの形を満たす）。 */
export type StackTooltipItem = {
  readonly chart: StackChart
  readonly dataIndex: number
  readonly parsed: { readonly y: number | null }
  readonly dataset: { readonly label?: string }
}

/** 凡例で隠していない系列（順番＝積む順）。 */
export function visibleOrders(chart: StackChart): number[] {
  return chart.data.datasets.flatMap((_, order) => (chart.isDatasetVisible(order) ? [order] : []))
}

/**
 * その棒の合計。棒の上の数字とツールチップで同じ値にする。
 * - **全系列が見えているとき**：`panel.totals`（ドメインが渡す正しい合計）。内訳は表示のために丸めてあるので、単純に足すと
 *   合計が 0.1 ずれ、KPI の数字と食い違う（docs/sales.md §4.5）
 * - **凡例で系列を隠したとき**：見えている系列の和（見えている棒と数字を一致させる）
 */
export function shownTotal(
  chart: StackChart,
  panel: TrendChartPanel,
  index: number,
  x: number,
): number {
  const orders = visibleOrders(chart)
  if (orders.length === chart.data.datasets.length) return stackTotalAt(panel, x)
  return orders.reduce((sum, order) => {
    const value = chart.data.datasets[order]?.data[index]
    return typeof value === 'number' ? sum + value : sum
  }, 0)
}

/** ツールチップの題（「2030年（推計）」）。 */
export function stackTooltipTitle(
  items: readonly StackTooltipItem[],
  panel: TrendChartPanel,
  xs: readonly number[],
): string {
  const x = items[0] === undefined ? undefined : xs[items[0].dataIndex]
  if (x === undefined) return ''
  return `${x}年${isProjected(panel, x) ? '（推計）' : ''}`
}

/** ツールチップ 1 行（「15〜64歳: 55,863 人（74.1%）」＝その年の合計に占める割合）。 */
export function stackTooltipLabel(
  item: StackTooltipItem,
  panel: TrendChartPanel,
  xs: readonly number[],
): string {
  const value = item.parsed.y
  const x = xs[item.dataIndex]
  const total = x === undefined ? 0 : shownTotal(item.chart, panel, item.dataIndex, x)
  const share =
    value === null || total === 0 ? '' : `（${formatNumber((value / total) * 100, 'percent1')}）`
  return `${item.dataset.label ?? ''}: ${formatWithUnit(value, panel.format, panel.unit)}${share}`
}

/** ツールチップの合計行（このパネルの主役は合計なので必ず出す）。 */
export function stackTooltipTotal(
  items: readonly StackTooltipItem[],
  panel: TrendChartPanel,
  xs: readonly number[],
): string {
  const first = items[0]
  const x = first === undefined ? undefined : xs[first.dataIndex]
  if (first === undefined || x === undefined) return ''
  const total = shownTotal(first.chart, panel, first.dataIndex, x)
  return `合計: ${formatWithUnit(total, panel.format, panel.unit)}`
}
