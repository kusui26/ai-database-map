'use client'

/** カテゴリ×指標の2段セレクト（optgroup=baseMetric・option=変種）。ランキング/散布で共用。 */

import { CATEGORIES, CATEGORY_LABELS_JA, type Category } from '@/shared/constants'
import { rankableGroups, variantLabel } from '@/domain/metrics'
import { cn } from '@/lib/utils'

export const METRIC_SELECT_CLASS =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-400'

export function MetricSelect({
  ariaPrefix = '',
  category,
  metricKey,
  onCategory,
  onMetric,
  className,
}: {
  ariaPrefix?: string
  category: Category
  metricKey: string
  onCategory: (category: Category) => void
  onMetric: (key: string) => void
  className?: string
}) {
  const selectCategory = (value: string) => {
    const found = CATEGORIES.find((c) => c === value)
    if (found !== undefined) onCategory(found)
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <select
        aria-label={`${ariaPrefix}カテゴリ`}
        className={METRIC_SELECT_CLASS}
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
        aria-label={`${ariaPrefix}指標`}
        className={cn(METRIC_SELECT_CLASS, 'min-w-0 flex-1')}
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
    </div>
  )
}
