'use client'

/** ランキングの指標ピッカ：都道府県 × カテゴリ → 指標（optgroup=baseMetric・option=変種）× 上位/下位。 */

import { type Order } from '@/shared/api'
import { CATEGORIES, CATEGORY_LABELS_JA, type Category, PREFECTURES } from '@/shared/constants'
import { rankableGroups, variantLabel } from '@/domain/metrics'
import { cn } from '@/lib/utils'

const SELECT_CLASS =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-400'

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
  const selectCategory = (value: string) => {
    const found = CATEGORIES.find((c) => c === value)
    if (found !== undefined) onCategory(found)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="都道府県"
        className={SELECT_CLASS}
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

      <select
        aria-label="カテゴリ"
        className={SELECT_CLASS}
        value={category}
        onChange={(e) => selectCategory(e.target.value)}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS_JA[c]}
          </option>
        ))}
      </select>

      <select
        aria-label="指標"
        className={cn(SELECT_CLASS, 'min-w-0 flex-1')}
        value={metricKey}
        onChange={(e) => onMetric(e.target.value)}
      >
        {rankableGroups(category).map((group) => (
          <optgroup key={group.baseMetric} label={group.labelJa}>
            {group.entries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {variantLabel(entry)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

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
