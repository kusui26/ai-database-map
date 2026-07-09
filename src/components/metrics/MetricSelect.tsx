'use client'

/**
 * カテゴリ×指標（半径なし変種）×半径セグメントの部品群（P6c→P6d）。
 * `useMetricParts`＝metricKey を (変種, 半径) に分解し、変種/半径の変更で metricKey を再解決する
 * 単一のコントローラ（親の状態は据え置き）。leaf（CategorySelect/VariantSelect/RadiusSegment）を
 * ランキングは2段に、散布は各軸インラインに、それぞれ好きな配置で組める。
 */

import { useMemo } from 'react'
import { CATEGORIES, CATEGORY_LABELS_JA, type Category, radiusLabel } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import {
  type MetricVariant,
  type VariantGroup,
  radiiOf,
  rankableVariantGroups,
  variantTokenOf,
} from '@/domain/metrics'
import { cn } from '@/lib/utils'

export const METRIC_SELECT_CLASS =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-400'

/** metricKey ↔ (変種, 半径) の分解・再解決を担う単一コントローラ。 */
export type MetricParts = {
  readonly ariaPrefix: string
  readonly category: Category
  readonly currentToken: string | undefined
  readonly groups: readonly VariantGroup[]
  readonly radii: readonly number[]
  readonly currentRadius: number | null
  readonly selectCategory: (value: string) => void
  readonly selectVariant: (token: string) => void
  readonly selectRadius: (radius: number) => void
}

export function useMetricParts(
  category: Category,
  metricKey: string,
  onCategory: (category: Category) => void,
  onMetric: (key: string) => void,
  ariaPrefix = '',
): MetricParts {
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

  return {
    ariaPrefix,
    category,
    currentToken,
    groups,
    radii,
    currentRadius,
    selectCategory,
    selectVariant,
    selectRadius,
  }
}

/** カテゴリ選択（乗降/人口/地価/…）。 */
export function CategorySelect({ parts }: { parts: MetricParts }) {
  return (
    <select
      aria-label={`${parts.ariaPrefix}カテゴリ`}
      className={METRIC_SELECT_CLASS}
      value={parts.category}
      onChange={(e) => parts.selectCategory(e.target.value)}
    >
      {CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_LABELS_JA[c]}
        </option>
      ))}
    </select>
  )
}

/** 指標（半径なし変種＝年/期間/ビンテージ）。optgroup=baseMetric。 */
export function VariantSelect({ parts, className }: { parts: MetricParts; className?: string }) {
  return (
    <select
      aria-label={`${parts.ariaPrefix}指標`}
      className={cn(METRIC_SELECT_CLASS, 'min-w-0 flex-1', className)}
      value={parts.currentToken ?? ''}
      onChange={(e) => parts.selectVariant(e.target.value)}
    >
      {parts.groups.map((group) => (
        <optgroup key={group.baseMetric} label={group.labelJa}>
          {group.variants.map((variant) => (
            <option key={variant.token} value={variant.token}>
              {variant.labelJa}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** 半径セグメント（利用可能な半径のみ・横スクロール）。半径非依存の指標では null。 */
export function RadiusSegment({ parts, className }: { parts: MetricParts; className?: string }) {
  if (parts.radii.length === 0) return null
  return (
    <div
      className={cn(
        'flex shrink-0 gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5',
        className,
      )}
    >
      {parts.radii.map((radius) => (
        <button
          key={radius}
          type="button"
          aria-label={`${parts.ariaPrefix}半径 ${radiusLabel(radius)}`}
          onClick={() => parts.selectRadius(radius)}
          className={cn(
            'shrink-0 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
            radius === parts.currentRadius
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {radiusLabel(radius)}
        </button>
      ))}
    </div>
  )
}

/** カテゴリ→指標→半径を横一列に（散布図の各軸で使用。外部 IF は従来どおり）。 */
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
  const parts = useMetricParts(category, metricKey, onCategory, onMetric, ariaPrefix)
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      <CategorySelect parts={parts} />
      <VariantSelect parts={parts} />
      <RadiusSegment parts={parts} />
    </div>
  )
}
