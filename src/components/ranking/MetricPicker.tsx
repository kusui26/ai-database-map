'use client'

/**
 * ランキングのピッカ（P6d）：2段構成。
 * 段A（常に同一）＝都道府県・カテゴリ・変種（年）・上位/下位・⚠除外。半径の有無で位置が動かない。
 * 段B（半径あり指標のときだけ）＝半径セグメントを単独で。半径なし指標（乗降客数等）は段Aの1段のまま。
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
import { PrefectureMultiSelect } from '@/components/metrics/PrefectureMultiSelect'

export function MetricPicker({
  category,
  metricKey,
  prefectures,
  order,
  excludeLowN,
  onCategory,
  onMetric,
  onPrefectures,
  onOrder,
  onExcludeLowN,
}: {
  category: Category
  metricKey: string
  prefectures: string[]
  order: Order
  excludeLowN: boolean
  onCategory: (category: Category) => void
  onMetric: (key: string) => void
  onPrefectures: (prefectures: string[]) => void
  onOrder: (order: Order) => void
  onExcludeLowN: (exclude: boolean) => void
}) {
  const parts = useMetricParts(category, metricKey, onCategory, onMetric)

  return (
    <div className="space-y-2">
      {/* 段A：常に同じ並び・同じ位置 */}
      <div className="flex flex-wrap items-center gap-2">
        <PrefectureMultiSelect selected={prefectures} onChange={onPrefectures} />
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

      {/* 段B：半径あり指標のときだけ（半径なしはこの段が出ず1段のまま） */}
      {parts.radii.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-slate-400">半径</span>
          <RadiusSegment parts={parts} />
        </div>
      )}
    </div>
  )
}
