'use client'

/** scatter Panel のレンダラ（Chart.js 散布・クラスタ色分け・点クリックで駅選択）。 */

import { useMemo } from 'react'
import { Scatter } from 'react-chartjs-2'
import { type ChartData, type ChartOptions } from 'chart.js'
import { type ScatterPanel } from '@/shared/protocol'
import { formatCompact, formatNumber, formatWithUnit, type MetricFormat } from '@/shared/format'
import { clusterColor } from '@/shared/constants'
import { ensureChartRegistered } from '@/components/charts/chart-setup'
import { groupPointsByCluster } from './scatterDatasets'
import { cn } from '@/lib/utils'

ensureChartRegistered()

const AXIS_COLOR = '#94a3b8'
const HEIGHT_PX: Record<'compact' | 'full', number> = { compact: 220, full: 340 }

/** 単位から整形指定を推定（散布の tooltip/軸用）。 */
function inferFormat(unit: string | null): MetricFormat {
  if (unit === '%') return 'percent1'
  if (unit === '円/㎡') return 'yen'
  if (unit === null) return 'decimal1'
  return 'int'
}

export function ScatterChart({
  panel,
  onSelect,
}: {
  panel: ScatterPanel
  onSelect?: (grp: string) => void
}) {
  const compact = panel.size === 'compact'
  const xFormat = inferFormat(panel.xUnit)
  const yFormat = inferFormat(panel.yUnit)

  // クラスタ別に点を保持（Chart.js には {x,y} のみ渡し、駅名/grp はこの配列から index で引く＝as 不要）。
  // 実在するクラスタ番号だけで束ねるため、上流の clusterCount に依存せず点が落ちない。
  const clusters = useMemo(() => groupPointsByCluster(panel.points), [panel.points])

  const data: ChartData<'scatter'> = useMemo(
    () => ({
      datasets: clusters.map((clusterPoints, c) => ({
        label: `クラスタ${c + 1}`,
        data: clusterPoints.map((p) => ({ x: p.x, y: p.y })),
        backgroundColor: clusterColor(c),
        pointRadius: compact ? 1.5 : 2.5,
        pointHoverRadius: 5,
      })),
    }),
    [clusters, compact],
  )

  const options: ChartOptions<'scatter'> = useMemo(() => {
    const pointAt = (datasetIndex: number, index: number) => clusters[datasetIndex]?.[index]
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: {
          title: { display: true, text: panel.xLabel, color: AXIS_COLOR, font: { size: 11 } },
          ticks: {
            maxTicksLimit: 6,
            callback: (v) =>
              panel.xUnit === '%' ? formatNumber(Number(v), 'percent1') : formatCompact(Number(v)),
            color: AXIS_COLOR,
            font: { size: 10 },
          },
          grid: { color: '#f1f5f9' },
          border: { display: false },
        },
        y: {
          title: { display: true, text: panel.yLabel, color: AXIS_COLOR, font: { size: 11 } },
          ticks: {
            maxTicksLimit: 6,
            callback: (v) =>
              panel.yUnit === '%' ? formatNumber(Number(v), 'percent1') : formatCompact(Number(v)),
            color: AXIS_COLOR,
            font: { size: 10 },
          },
          grid: { color: '#f1f5f9' },
          border: { display: false },
        },
      },
      plugins: {
        // クラスタ番号は k-means の任意 index（意味を持たない）→ 凡例は出さず、色分け＋副題「Mクラスタ」で表現。
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => '',
            label: (item) => {
              const p = pointAt(item.datasetIndex, item.dataIndex)
              if (p === undefined) return ''
              const x = formatWithUnit(p.x, xFormat, panel.xUnit)
              const y = formatWithUnit(p.y, yFormat, panel.yUnit)
              return `${p.name}｜${panel.xLabel} ${x} / ${panel.yLabel} ${y}`
            },
          },
        },
      },
      onClick: (event, _elements, chart) => {
        if (onSelect === undefined) return
        const native = event.native
        if (native === null) return
        // クリックは最寄り点を選択（正確にヒットしなくてよい）。hover は intersect:true で厳密。
        const items = chart.getElementsAtEventForMode(
          native,
          'nearest',
          { intersect: false },
          false,
        )
        const first = items[0]
        if (first === undefined) return
        const p = pointAt(first.datasetIndex, first.index)
        if (p !== undefined) onSelect(p.grp)
      },
    }
  }, [clusters, panel.xLabel, panel.yLabel, panel.xUnit, panel.yUnit, xFormat, yFormat, onSelect])

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
          {panel.title}
        </h3>
        <span className="shrink-0 text-xs text-slate-400">
          {panel.points.length}駅・{panel.clusterCount}クラスタ
        </span>
      </div>
      <div className="mt-2" style={{ height: HEIGHT_PX[compact ? 'compact' : 'full'] }}>
        {panel.points.length > 0 ? (
          <Scatter data={data} options={options} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-400">
            データがありません
          </div>
        )}
      </div>
    </section>
  )
}
