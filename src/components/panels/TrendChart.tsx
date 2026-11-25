'use client'

/**
 * トレンドチャート Panel のレンダラ（Chart.js ＋ KPI チップ＋信頼性フラグ）。
 *
 * 既定は折れ線。`panel.stacked === true` のときだけ**積み上げ縦棒**にする
 * （内訳の合計そのものが指標のとき＝売上・年齢別の人口）。軸・凡例・ツールチップの見た目は共通。
 * `panel.projectedFrom` があれば、その年からの棒を淡く描き、実績との境に破線と「推計」を置く（年齢別の人口・261125）。
 */

import { useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import { Chart, type ChartData, type ChartOptions, type Plugin } from 'chart.js'
import { type TrendChartPanel } from '@/shared/protocol'
import {
  ACCENT_COLOR,
  PROJECTED_OPACITY,
  PROJECTION_LABEL_COLOR,
  PROJECTION_LABEL_GAP_PX,
  PROJECTION_RULE_COLOR,
  PROJECTION_RULE_DASH_PX,
  SEGMENT_GAP_PX,
} from '@/shared/constants'
import { formatCompact, formatNumber, formatWithUnit } from '@/shared/format'
import { ensureChartRegistered } from '@/components/charts/chart-setup'
import { cn } from '@/lib/utils'
import { isProjected, labeledTotalXs, projectedIndex, trendXs } from '@/shared/trend-stack'
import {
  shownTotal,
  stackTooltipLabel,
  stackTooltipTitle,
  stackTooltipTotal,
  visibleOrders,
} from './stackedChart'

ensureChartRegistered()

const HEIGHT_PX: Record<'compact' | 'full', number> = { compact: 148, full: 216 }
const GRID_COLOR = '#f1f5f9'
const AXIS_COLOR = '#94a3b8'
/** 積み上げの合計ラベル（slate-600）。軸ラベルより濃く、見出しより薄い。 */
const TOTAL_LABEL_COLOR = '#475569'
/** 合計ラベルと棒の間隔（px）。 */
const TOTAL_LABEL_GAP_PX = 6
/** 棒の上の合計の居場所（上の余白・px）。 */
const TOTAL_PADDING_PX: Record<'compact' | 'full', number> = { compact: 14, full: 18 }
/** 棒の上の字（合計・「推計」）の大きさ（px）。 */
const LABEL_FONT_PX: Record<'compact' | 'full', number> = { compact: 10, full: 11 }
/** 「推計」の文字の居場所（合計の上にもう 1 段・px）。推計のある図だけ。 */
const PROJECTION_LABEL_PX = 13
/** 区分の間のすき間に見せる面の色（パネルの白）。 */
const SURFACE_COLOR = '#ffffff'

/** ツールチップ 1 項目のうち、折れ線で使うぶんだけ。 */
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

/** x（年）の一覧を全系列から統合して昇順に並べる（積み上げの規則と同じ並び・`shared/trend-stack.ts`）。 */
function useLabels(panel: TrendChartPanel): number[] {
  return useMemo(() => trendXs(panel), [panel])
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
          // 凡例を出す図（系列が別のエリア）は塗らない——塗りが重なって濁り、実績と推計の重なる年が帯に見える。
          fill: panel.legend !== true,
          spanGaps: false,
        }
      }),
    }),
    [labels, panel.series, panel.legend, compact],
  )

  const options: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: buildScales(compact, isPercent, false),
      plugins: {
        // 折れ線は**既定で凡例を出さない**（Legend プラグインが未登録だった時代からの見た目を保つ）。
        // 実線/破線と色で区別でき、系列名はツールチップに出る。系列が別のエリアのとき（`panel.legend`・B5b）だけ
        // 下に出す——載せるのは実線の系列だけ（破線の推計は同じ色の実線と組で読む）。
        legend: {
          display: panel.legend === true,
          position: 'bottom',
          labels: {
            boxWidth: 12,
            boxHeight: 2,
            padding: 10,
            font: { size: 11 },
            filter: (item) => panel.series[item.datasetIndex ?? -1]?.dashed !== true,
          },
        },
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

/** その棒のいちばん上（見えている系列の要素の上端）。系列が全部隠れていれば null。 */
function stackTop(chart: Chart, index: number): { x: number; y: number } | null {
  return visibleOrders(chart).reduce<{ x: number; y: number } | null>((top, order) => {
    const element = chart.getDatasetMeta(order).data[index]
    const value = chart.data.datasets[order]?.data[index]
    if (element === undefined || typeof value !== 'number') return top
    return top === null || element.y < top.y ? { x: element.x, y: element.y } : top
  }, null)
}

/**
 * 積み上げ棒の上に**合計**を描くプラグイン。Chart.js は値ラベルを描かないので自前で描く
 * （このためだけに datalabels プラグインを足さない）。値は `shownTotal`、書く年は `labeledTotalXs`
 * （推計のある図は最後の実績の年と最後の年だけ。間の年はツールチップ）。
 */
function stackTotalPlugin(
  panel: TrendChartPanel,
  xs: readonly number[],
  compact: boolean,
): Plugin<'bar'> {
  const labeled = labeledTotalXs(panel, xs)
  return {
    id: 'stackTotal',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      ctx.save()
      ctx.font = `600 ${LABEL_FONT_PX[compact ? 'compact' : 'full']}px ${Chart.defaults.font.family}`
      ctx.fillStyle = TOTAL_LABEL_COLOR
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      xs.forEach((x, index) => {
        const top = stackTop(chart, index)
        const total = shownTotal(chart, panel, index, x)
        if (!labeled.has(x) || top === null || total === 0) return
        ctx.fillText(formatNumber(total, panel.format), top.x, top.y - TOTAL_LABEL_GAP_PX)
      })
      ctx.restore()
    },
  }
}

/** 実績と推計の境の x（最後の実績の棒と最初の推計の棒のまん中）。推計の無い図は null。 */
function projectionRuleX(chart: Chart, first: number): number | null {
  const scale = chart.scales.x
  if (first <= 0 || scale === undefined) return null
  return (scale.getPixelForValue(first - 1) + scale.getPixelForValue(first)) / 2
}

/** 境の破線（「推計」の段の下から、描画域の下まで）。 */
function strokeProjectionRule(ctx: CanvasRenderingContext2D, x: number, bottom: number): void {
  ctx.strokeStyle = PROJECTION_RULE_COLOR
  ctx.lineWidth = 1
  ctx.setLineDash([...PROJECTION_RULE_DASH_PX])
  ctx.beginPath()
  ctx.moveTo(x, PROJECTION_LABEL_PX)
  ctx.lineTo(x, bottom)
  ctx.stroke()
}

/** 「推計」の文字（破線の右・いちばん上の段＝合計の数字の上）。 */
function fillProjectionLabel(ctx: CanvasRenderingContext2D, x: number, compact: boolean): void {
  ctx.font = `${LABEL_FONT_PX[compact ? 'compact' : 'full']}px ${Chart.defaults.font.family}`
  ctx.fillStyle = PROJECTION_LABEL_COLOR
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('推計', x + PROJECTION_LABEL_GAP_PX, 0)
}

/**
 * 実績と推計の境に破線を引き、その右上に「推計」と書くプラグイン。「推計」は合計の数字の上の段に置く（合計の数字と
 * 重ならない）。破線は棒の後ろに描く。推計の無い図では何もしない。
 */
function projectionRulePlugin(
  panel: TrendChartPanel,
  xs: readonly number[],
  compact: boolean,
): Plugin<'bar'> {
  const first = projectedIndex(panel, xs)
  return {
    id: 'projectionRule',
    beforeDatasetsDraw(chart) {
      const x = projectionRuleX(chart, first)
      if (x === null) return
      chart.ctx.save()
      strokeProjectionRule(chart.ctx, x, chart.chartArea.bottom)
      fillProjectionLabel(chart.ctx, x, compact)
      chart.ctx.restore()
    },
  }
}

/**
 * 積み上げの系列 1 本。推計の年は淡く（凡例の見本は最初の年＝実績の色になる。Chart.js は 0 番目の要素の色で描く）。
 * 上の縁を面の色で塗って、区分の間にすき間を作る（棒の大きさは変わらない）。
 */
function stackedDataset(
  series: TrendChartPanel['series'][number],
  labels: readonly number[],
  faint: readonly boolean[],
  compact: boolean,
): ChartData<'bar'>['datasets'][number] {
  const color = series.color ?? ACCENT_COLOR
  return {
    label: series.label,
    data: alignedValues(series.points, labels),
    backgroundColor: faint.map((projected) =>
      projected ? withAlpha(color, PROJECTED_OPACITY) : color,
    ),
    borderColor: SURFACE_COLOR,
    borderWidth: { top: SEGMENT_GAP_PX, right: 0, bottom: 0, left: 0 },
    borderRadius: 2,
    maxBarThickness: compact ? 40 : 64,
  }
}

/** 積み上げのデータ。 */
function stackedData(panel: TrendChartPanel, labels: number[], compact: boolean): ChartData<'bar'> {
  const faint = labels.map((x) => isProjected(panel, x))
  return {
    labels: labels.map(String),
    datasets: panel.series.map((series) => stackedDataset(series, labels, faint, compact)),
  }
}

/**
 * 積み上げの設定。棒の上に合計を描くので、その分の余白を上に取る（描画域の外に出て切れないように）。
 * 推計のある図は、その上に「推計」の文字の段を足す。
 */
function stackedOptions(panel: TrendChartPanel, labels: readonly number[]): ChartOptions<'bar'> {
  const compact = panel.size === 'compact'
  const isPercent = panel.format === 'percent1' || panel.format === 'ratio1'
  const projected = projectedIndex(panel, labels) > 0
  const top = TOTAL_PADDING_PX[compact ? 'compact' : 'full'] + (projected ? PROJECTION_LABEL_PX : 0)
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top } },
    scales: buildScales(compact, isPercent, true),
    plugins: { legend: stackedLegend(panel), tooltip: stackedTooltip(panel, labels) },
  }
}

/** 積み上げの図のプラグイン設定（凡例・ツールチップ）。 */
type StackedPlugins = NonNullable<ChartOptions<'bar'>['plugins']>

/** 積み上げの凡例（色だけでは内訳が読めないので出す・下・小さめ・箱は正方形）。 */
function stackedLegend(panel: TrendChartPanel): StackedPlugins['legend'] {
  return {
    display: panel.series.length > 1,
    position: 'bottom',
    labels: { boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 11 } },
  }
}

/** 積み上げのツールチップ（題＝年と推計・行＝区分の値と割合・足＝合計）。 */
function stackedTooltip(
  panel: TrendChartPanel,
  labels: readonly number[],
): StackedPlugins['tooltip'] {
  return {
    callbacks: {
      title: (items) => stackTooltipTitle(items, panel, labels),
      label: (item) => stackTooltipLabel(item, panel, labels),
      footer: (items) => stackTooltipTotal(items, panel, labels),
    },
  }
}

/** 積み上げ縦棒（`stacked`＝内訳の合計そのものが指標のとき）。 */
function StackedTrend({ panel, labels }: { panel: TrendChartPanel; labels: number[] }) {
  const compact = panel.size === 'compact'
  const data = useMemo(() => stackedData(panel, labels, compact), [panel, labels, compact])
  const options = useMemo(() => stackedOptions(panel, labels), [panel, labels])
  const plugins = useMemo(
    () => [stackTotalPlugin(panel, labels, compact), projectionRulePlugin(panel, labels, compact)],
    [panel, labels, compact],
  )
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
