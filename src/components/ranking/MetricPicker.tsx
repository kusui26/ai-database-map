'use client'

/** ランキングのピッカ：複数都道府県 × カテゴリ→指標（半径付き）× 上位/下位 × ⚠除外（P6c）。 */

import { type Order } from '@/shared/api'
import { type Category } from '@/shared/constants'
import { cn } from '@/lib/utils'
import { MetricSelect } from '@/components/metrics/MetricSelect'
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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrefectureMultiSelect selected={prefectures} onChange={onPrefectures} />
      <MetricSelect
        category={category}
        metricKey={metricKey}
        onCategory={onCategory}
        onMetric={onMetric}
        className="flex-1"
      />
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
      <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={excludeLowN}
          onChange={(e) => onExcludeLowN(e.target.checked)}
          className="size-4 accent-indigo-600"
        />
        ⚠除外
      </label>
    </div>
  )
}
