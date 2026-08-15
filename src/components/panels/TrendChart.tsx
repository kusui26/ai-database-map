'use client'

/** トレンドチャート Panel のレンダラ（Chart.js 折れ線＋KPI チップ＋信頼性フラグ）。 */

import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { type ChartData, type ChartOptions } from 'chart.js'
import { type TrendChartPanel } from '@/shared/protocol'
import { ACCENT_COLOR } from '@/shared/constants'
import { formatCompact, formatNumber, formatWithUnit } from '@/shared/format'
import { ensureChartRegistered } from '@/components/charts/chart-setup'
import { cn } from '@/lib/utils'

ensureChartRegistered()

const HEIGHT_PX: Record<'compact' | 'full', number> = { compact: 148, full: 216 }
const GRID_COLOR = '#f1f5f9'
const AXIS_COLOR = '#94a3b8'

/** hex 色を rgba（低アルフ塗り）に変換する。 */
function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function TrendChart({ panel }: { panel: TrendChartPanel }) {
  const compact = panel.size === 'compact'
  const isPercent = panel.format === 'percent1' || panel.format === 'ratio1'

  // 全系列の x（年）を統合してラベル化し、各系列を欠損 null で整列させる。
  const labels = useMemo(() => {
    const xs = new Set<number>()
    for (const series of panel.series) for (const point of series.points) xs.add(point.x)
    return [...xs].sort((a, b) => a - b)
  }, [panel.series])

  const data: ChartData<'line'> = useMemo(() => {
    return {
      labels: labels.map(String),
      datasets: panel.series.map((series) => {
        const byX = new Map(series.points.map((point) => [point.x, point.y]))
        const color = series.color ?? ACCENT_COLOR
        return {
          label: series.label,
          data: labels.map((x) => byX.get(x) ?? null),
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
    }
  }, [labels, panel.series, compact])

  const options: ChartOptions<'line'> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
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
          beginAtZero: false,
          ticks: {
            maxTicksLimit: compact ? 3 : 5,
            callback: (value) =>
              isPercent ? formatNumber(Number(value), 'percent1') : formatCompact(Number(value)),
            font: { size: 11 },
            color: AXIS_COLOR,
          },
          grid: { color: GRID_COLOR },
          border: { display: false },
        },
      },
      plugins: {
        legend: { display: panel.series.length > 1 },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] === undefined ? '' : `${items[0].label}年`),
            label: (item) =>
              `${item.dataset.label}: ${formatWithUnit(item.parsed.y, panel.format, panel.unit)}`,
          },
        },
      },
    }
  }, [compact, isPercent, panel.format, panel.unit, panel.series.length])

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
          <Line data={data} options={options} />
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
