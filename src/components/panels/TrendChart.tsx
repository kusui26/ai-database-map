'use client'

/**
 * トレンドチャート Panel のレンダラ（Chart.js ＋ KPI チップ＋信頼性フラグ）。
 *
 * 既定は折れ線。`panel.stacked === true` のときだけ**積み上げ縦棒**にする
 * （内訳の合計そのものが指標のとき＝売上）。軸・凡例・ツールチップの見た目は共通。
 */

import { useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { Chart, type ChartData, type ChartOptions, type Plugin } from 'chart.js'
import { type TrendChartPanel } from '@/shared/protocol'
import { ACCENT_COLOR } from '@/shared/constants'
import { formatCompact, formatNumber, formatWithUnit } from '@/shared/format'
import { ensureChartRegistered } from '@/components/charts/chart-setup'
import { cn } from '@/lib/utils'

ensureChartRegistered()

const HEIGHT_PX: Record<'compact' | 'full', number> = { compact: 148, full: 216 }
const GRID_COLOR = '#f1f5f9'
const AXIS_COLOR = '#94a3b8'
/** 積み上げの合計ラベル（slate-600）。軸ラベルより濃く、見出しより薄い。 */
const TOTAL_LABEL_COLOR = '#475569'
/** 合計ラベルと棒の間隔（px）。 */
const TOTAL_LABEL_GAP_PX = 6

/** ツールチップ 1 項目のうち、折れ線・棒で共通して使うぶんだけ。 */
type TooltipLike = { dataset: { label?: string }; parsed: { y: number | null } }

/** hex 色を rgba（低アルフ塗り）に変換する。 */
function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 軸の設定（折れ線・棒で共通）。`stacked` のときは積み上げ＋0 起点にする
 * （積み上げは「量の足し算」なので 0 から描かないと面積が嘘になる）。
 *
 * chart.js の `scales` 型は line と bar で同一なので、1 つ作って両方に渡せる。
 */
function buildScales(
  compact: boolean,
  isPercent: boolean,
  stacked: boolean,
): ChartOptions<'line'>['scales'] {
  return {
    x: {
      stacked,
      ticks: {
        autoSkip: true,
        maxRotation: 0,
        maxTicksLimit: compact ? 4 : 8,
        font: { size: 11 },
        color: AXIS_COLOR,
      },
      grid: { display: false },
      border: { display: false },
    },
    y: {
      stacked,
      beginAtZero: stacked,
      ticks: {
        maxTicksLimit: compact ? 3 : 5,
        callback: (value: string | number) =>
          isPercent ? formatNumber(Number(value), 'percent1') : formatCompact(Number(value)),
        font: { size: 11 },
        color: AXIS_COLOR,
      },
      grid: { color: GRID_COLOR },
      border: { display: false },
    },
  }
}

/** ツールチップ 1 行（系列名: 値＋単位）。 */
function tooltipLabel(item: TooltipLike, panel: TrendChartPanel): string {
  return `${item.dataset.label ?? ''}: ${formatWithUnit(item.parsed.y, panel.format, panel.unit)}`
}

/** 積み上げの合計行（このパネルの主役は合計なので必ず出す）。 */
function tooltipTotal(items: readonly TooltipLike[], panel: TrendChartPanel): string {
  const total = items.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0)
  return `合計: ${formatWithUnit(total, panel.format, panel.unit)}`
}

/** x（年）の一覧を全系列から統合して昇順に並べる。 */
function useLabels(panel: TrendChartPanel): number[] {
  return useMemo(() => {
    const xs = new Set<number>()
    for (const series of panel.series) for (const point of series.points) xs.add(point.x)
    return [...xs].sort((a, b) => a - b)
  }, [panel.series])
}

/** 系列 → x で整列した値の配列（欠損は null＝ギャップ）。 */
function alignedValues(
  points: readonly { x: number; y: number | null }[],
  labels: readonly number[],
): (number | null)[] {
  const byX = new Map(points.map((point) => [point.x, point.y]))
  return labels.map((x) => byX.get(x) ?? null)
}

/** 折れ線（既定）。 */
function LineTrend({ panel, labels }: { panel: TrendChartPanel; labels: number[] }) {
  const compact = panel.size === 'compact'
  const isPercent = panel.format === 'percent1' || panel.format === 'ratio1'

  const data: ChartData<'line'> = useMemo(
    () => ({
      labels: labels.map(String),
      datasets: panel.series.map((series) => {
        const color = series.color ?? ACCENT_COLOR
        return {
          label: series.label,
          data: alignedValues(series.points, labels),
          borderColor: color,
          backgroundColor: withAlpha(color, 0.08),
          borderWidth: 2,
          borderDash: series.dashed === true ? [5, 4] : undefined,
          pointRadius: compact ? 0 : 2,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: true,
          spanGaps: false,
        }
      }),
    }),
    [labels, panel.series, compact],
  )

  const options: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: buildScales(compact, isPercent, false),
      plugins: {
        // 折れ線は**凡例を出さない**（Legend プラグインが未登録だった時代からの見た目を保つ）。
        // 実線/破線と色で区別でき、系列名はツールチップに出る。出すかどうかは別途決める。
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] === undefined ? '' : `${items[0].label}年`),
            label: (item) => tooltipLabel(item, panel),
          },
        },
      },
    }),
    [compact, isPercent, panel],
  )

  return <Line data={data} options={options} />
}

/**
 * 積み上げ棒の上に**合計**を描くプラグイン。Chart.js は値ラベルを描かないので自前で描く
 * （このためだけに datalabels プラグインを足さない）。
 *
 * 描く値は 2 通りに分ける。
 * - **全系列が見えているとき**：`panel.totals`（ドメインが渡す正しい合計）。内訳は表示のために
 *   丸めてあるので、単純に足すと合計が 0.1 ずれ、KPI の数字と食い違う（docs/sales.md §4.5）。
 * - **凡例で系列を隠したとき**：表示中の系列の和。見えている棒と数字を一致させるため。
 */
function stackTotalPlugin(panel: TrendChartPanel, compact: boolean): Plugin<'bar'> {
  const authoritative = new Map((panel.totals ?? []).map((point) => [point.x, point.y]))
  return {
    id: 'stackTotal',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      ctx.save()
      ctx.font = `600 ${compact ? 10 : 11}px ${Chart.defaults.font.family}`
      ctx.fillStyle = TOTAL_LABEL_COLOR
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      const allVisible = chart.data.datasets.every((_, order) => chart.isDatasetVisible(order))
      const count = chart.data.labels?.length ?? 0
      for (let index = 0; index < count; index += 1) {
        let sum = 0
        let top: number | null = null
        let x = 0
        chart.data.datasets.forEach((dataset, order) => {
          if (!chart.isDatasetVisible(order)) return
          const value = dataset.data[index]
          const element = chart.getDatasetMeta(order).data[index]
          if (typeof value !== 'number' || element === undefined) return
          sum += value
          x = element.x
          top = top === null ? element.y : Math.min(top, element.y)
        })
        const label = Number(chart.data.labels?.[index])
        const exact = allVisible ? authoritative.get(label) : undefined
        const total = exact ?? sum
        if (top === null || total === null || total === 0) continue
        ctx.fillText(formatNumber(total, panel.format), x, top - TOTAL_LABEL_GAP_PX)
      }
      ctx.restore()
    },
  }
}

/** 積み上げ縦棒（`stacked`＝内訳の合計そのものが指標のとき）。 */
function StackedTrend({ panel, labels }: { panel: TrendChartPanel; labels: number[] }) {
  const compact = panel.size === 'compact'
  const isPercent = panel.format === 'percent1' || panel.format === 'ratio1'

  const data: ChartData<'bar'> = useMemo(
    () => ({
      labels: labels.map(String),
      datasets: panel.series.map((series) => ({
        label: series.label,
        data: alignedValues(series.points, labels),
        backgroundColor: series.color ?? ACCENT_COLOR,
        borderWidth: 0,
        borderRadius: 2,
        maxBarThickness: compact ? 40 : 64,
      })),
    }),
    [labels, panel.series, compact],
  )

  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      // 棒の上に合計を描くので、その分の余白を上に取る（描画域の外に出て切れないように）。
      layout: { padding: { top: compact ? 14 : 18 } },
      scales: buildScales(compact, isPercent, true),
      plugins: {
        // 積み上げは色だけでは内訳が読めないので凡例を出す（下・小さめ・箱は正方形）。
        legend: {
          display: panel.series.length > 1,
          position: 'bottom',
          labels: { boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] === undefined ? '' : `${items[0].label}年`),
            label: (item) => tooltipLabel(item, panel),
            footer: (items) => tooltipTotal(items, panel),
          },
        },
      },
    }),
    [compact, isPercent, panel],
  )

  const plugins = useMemo(() => [stackTotalPlugin(panel, compact)], [panel, compact])

  return <Bar data={data} options={options} plugins={plugins} />
}

export function TrendChart({ panel }: { panel: TrendChartPanel }) {
  const compact = panel.size === 'compact'
  const labels = useLabels(panel)
  const hasData = panel.series.some((series) => series.points.some((point) => point.y !== null))

  return (
    <section className={cn('rounded-xl', compact ? '' : 'bg-white')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
          {panel.title}
        </h3>
        {/* 単位はそれ自体が 1 語なので折り返さない（「万円/」「人」の 2 行割れを防ぐ）。 */}
        {panel.unit !== null && (
          <span className="shrink-0 text-xs whitespace-nowrap text-slate-400">
            単位: {panel.unit}
          </span>
        )}
      </div>

      {panel.stats !== undefined && panel.stats.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {panel.stats.map((stat) => (
            <li key={stat.label} className="rounded-lg bg-slate-50 px-2.5 py-1">
              <span className="text-xs text-slate-400">{stat.label}</span>{' '}
              <span
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  stat.flagged ? 'text-amber-600' : 'text-slate-800',
                )}
              >
                {stat.value}
                {stat.flagged ? ' ⚠' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3" style={{ height: HEIGHT_PX[compact ? 'compact' : 'full'] }}>
        {hasData ? (
          panel.stacked === true ? (
            <StackedTrend panel={panel} labels={labels} />
          ) : (
            <LineTrend panel={panel} labels={labels} />
          )
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-400">
            データがありません
          </div>
        )}
      </div>

      {panel.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {panel.flags.map((flag) => (
            <li
              key={flag.label}
              className={cn('text-xs', flag.level === 'warn' ? 'text-amber-600' : 'text-slate-400')}
            >
              {flag.level === 'warn' ? '⚠ ' : ''}
              {flag.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
