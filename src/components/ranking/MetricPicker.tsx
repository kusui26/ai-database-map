'use client'

/**
 * ランキングのピッカ（P6d → 260801）：3段構成。
 * 段A（絞り込み）＝都道府県・運営会社・路線。散布と同じ並び・同じ連動（StationFilterControls）。
 * 段B（常に同一）＝カテゴリ・変種（年）・上位/下位・⚠除外。半径の有無で位置が動かない。
 * 段C（半径あり指標のときだけ）＝半径セグメントを単独で。
 *
 * 絞り込みを独立させたのは、672px の 1 段に 7 コントロールが入らないため（実測：段Aの内寸
 * 640px を使い切っており余白 0px）。分けたことで変種セレクトは 245→321px に広がる
 * （docs/260801_ranking_filter.md §4）。
 */

import { type Order } from '@/shared/api'
import { type Category } from '@/shared/constants'
import { cn } from '@/lib/utils'
import {
  CategorySelect,
  RadiusSegment,
  VariantSelect,
  useMetricParts,
} from '@/components/metrics/MetricSelect'
import { StationFilterControls } from '@/components/metrics/StationFilterControls'
import { type StationFiltersState } from '@/components/metrics/useStationFilters'

export function MetricPicker({
  category,
  metricKey,
  filters,
  order,
  excludeLowN,
  onCategory,
  onMetric,
  onOrder,
  onExcludeLowN,
}: {
  category: Category
  metricKey: string
  filters: StationFiltersState
  order: Order
  excludeLowN: boolean
  onCategory: (category: Category) => void
  onMetric: (key: string) => void
  onOrder: (order: Order) => void
  onExcludeLowN: (exclude: boolean) => void
}) {
  const parts = useMetricParts(category, metricKey, onCategory, onMetric)

  return (
    <div className="space-y-2">
      {/* 段A：絞り込み（散布と同じ並び・同じ連動） */}
      <div className="flex flex-wrap items-center gap-2">
        <StationFilterControls state={filters} />
      </div>

      {/* 段B：常に同じ並び・同じ位置 */}
      <div className="flex flex-wrap items-center gap-2">
        <CategorySelect parts={parts} />
        <VariantSelect parts={parts} className="flex-1" />
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200">
          {(
            [
              ['desc', '上位'],
              ['asc', '下位'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onOrder(value)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors',
                order === value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={excludeLowN}
            onChange={(e) => onExcludeLowN(e.target.checked)}
            className="size-4 accent-indigo-600"
          />
          ⚠除外
        </label>
      </div>

      {/* 段C：半径あり指標のときだけ（半径なしはこの段が出ない） */}
      {parts.radii.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">半径</span>
          <RadiusSegment parts={parts} />
        </div>
      )}
    </div>
  )
}
