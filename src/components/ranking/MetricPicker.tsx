'use client'

/** ランキングの指標ピッカ：都道府県 × カテゴリ→指標（MetricSelect）× 上位/下位。 */

import { type Order } from '@/shared/api'
import { type Category, PREFECTURES } from '@/shared/constants'
import { cn } from '@/lib/utils'
import { METRIC_SELECT_CLASS, MetricSelect } from '@/components/metrics/MetricSelect'

export function MetricPicker({
  category,
  metricKey,
  prefecture,
  order,
  onCategory,
  onMetric,
  onPrefecture,
  onOrder,
}: {
  category: Category
  metricKey: string
  prefecture: string | null
  order: Order
  onCategory: (category: Category) => void
  onMetric: (key: string) => void
  onPrefecture: (prefecture: string | null) => void
  onOrder: (order: Order) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="都道府県"
        className={METRIC_SELECT_CLASS}
        value={prefecture ?? ''}
        onChange={(e) => onPrefecture(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">全国</option>
        {PREFECTURES.map((p) => (
          <option key={p.code} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>

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
    </div>
  )
}
