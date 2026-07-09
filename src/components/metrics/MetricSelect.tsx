'use client'

/**
 * カテゴリ×指標（半径なし変種）×半径セグメントの3段（P6c）。ランキング/散布で共用。
 * 外部 IF は (category, metricKey) のまま——内部で metricKey を (変種, 半径) に分解して表示し、
 * 変種/半径の変更で metricKey を再解決する（親の状態は据え置き）。
 */

import { useMemo } from 'react'
import { CATEGORIES, CATEGORY_LABELS_JA, type Category, radiusLabel } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import {
  type MetricVariant,
  radiiOf,
  rankableVariantGroups,
  variantTokenOf,
} from '@/domain/metrics'
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
  const groups = useMemo(() => rankableVariantGroups(category), [category])
  const variantByToken = useMemo(() => {
    const map = new Map<string, MetricVariant>()
    for (const group of groups) for (const variant of group.variants) map.set(variant.token, variant)
    return map
  }, [groups])

  const currentToken = variantTokenOf(metricKey)
  const currentVariant = currentToken === undefined ? undefined : variantByToken.get(currentToken)
  const radii = currentVariant === undefined ? [] : radiiOf(currentVariant)
  const currentRadius = getEntry(metricKey)?.radiusM ?? null

  const selectCategory = (value: string) => {
    const found = CATEGORIES.find((c) => c === value)
    if (found !== undefined) onCategory(found)
  }
  const selectVariant = (token: string) => {
    const variant = variantByToken.get(token)
    if (variant === undefined) return
    // 現在の半径を維持、無ければ先頭の利用可能半径（or 半径なし）へフォールバック。
    const radius = variant.byRadius.has(currentRadius) ? currentRadius : (radiiOf(variant)[0] ?? null)
    const key = variant.byRadius.get(radius)
    if (key !== undefined) onMetric(key)
  }
  const selectRadius = (radius: number) => {
    const key = currentVariant?.byRadius.get(radius)
    if (key !== undefined) onMetric(key)
  }

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
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
        value={currentToken ?? ''}
        onChange={(e) => selectVariant(e.target.value)}
      >
        {groups.map((group) => (
          <optgroup key={group.baseMetric} label={group.labelJa}>
            {group.variants.map((variant) => (
              <option key={variant.token} value={variant.token}>
                {variant.labelJa}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {radii.length > 0 && (
        <div className="flex shrink-0 gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5">
          {radii.map((radius) => (
            <button
              key={radius}
              type="button"
              aria-label={`${ariaPrefix}半径 ${radiusLabel(radius)}`}
              onClick={() => selectRadius(radius)}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
                radius === currentRadius
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {radiusLabel(radius)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
