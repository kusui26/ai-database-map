'use client'

/**
 * エリアの図の「地図の色分け」と「駅の周りの半径」（2026-10-15 B5e・§6.12.10）。
 *
 * 指標はカテゴリと指標（年・期間）だけを選ばせ、半径は図の 1 つの半径で引く（`areaColor.ts`）——駅の周りの値と色分けが
 * 同じ半径になる（AI の道具 `getAreaSummary` と同じ）。「色分けしない」も選べる（地図の色分けを消す）。
 * 選んだ結果の色と段・色の意味は、図の要約の凡例と地図の凡例が出す（サーバが決める）。
 */

import { useMemo } from 'react'
import {
  CATEGORY_LABELS_JA,
  NO_COLORING,
  RADII_M,
  radiusLabel,
  type RadiusM,
} from '@/shared/constants'
import { rankableVariantGroups } from '@/domain/metrics'
import { cn } from '@/lib/utils'
import { METRIC_SELECT_CLASS } from '@/components/metrics/MetricSelect'
import {
  COLOR_CATEGORIES,
  colorByForCategory,
  colorByForVariant,
  colorSelectionOf,
  type ColorSelection,
} from './areaColor'

function VariantSelect({
  selection,
  radiusM,
  colorBy,
  onColorBy,
}: {
  selection: Extract<ColorSelection, { kind: 'metric' }>
  radiusM: RadiusM
  colorBy: string | null
  onColorBy: (colorBy: string | null) => void
}) {
  const groups = useMemo(() => rankableVariantGroups(selection.category), [selection.category])
  return (
    <select
      aria-label="色分けの指標"
      className={cn(METRIC_SELECT_CLASS, 'w-full min-w-0 sm:w-auto sm:flex-1')}
      value={selection.token}
      onChange={(event) =>
        onColorBy(colorByForVariant(selection.category, event.target.value, radiusM, colorBy))
      }
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
  )
}

function RadiusButtons({
  value,
  onChange,
}: {
  value: RadiusM
  onChange: (radiusM: RadiusM) => void
}) {
  return (
    <div
      role="group"
      aria-label="駅の周りの半径"
      title="駅の周りの値と、地図の色分けの半径"
      className="flex shrink-0 gap-0.5 rounded-lg bg-slate-100 p-0.5"
    >
      {RADII_M.map((radius) => (
        <button
          key={radius}
          type="button"
          aria-pressed={radius === value}
          aria-label={`駅の周り ${radiusLabel(radius)}`}
          onClick={() => onChange(radius)}
          className={cn(
            'shrink-0 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
            radius === value
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

export function AreaColorControls({
  radiusM,
  colorBy,
  onColorBy,
  onRadius,
}: {
  radiusM: RadiusM
  /** 図の色分けの値（null＝既定・`none`＝色分けしない）。 */
  colorBy: string | null
  onColorBy: (colorBy: string | null) => void
  onRadius: (radiusM: RadiusM) => void
}) {
  const selection = colorSelectionOf(colorBy, radiusM)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-xs font-medium text-slate-400">地図の色分け</span>
        <select
          aria-label="色分けのカテゴリ"
          className={METRIC_SELECT_CLASS}
          value={selection.kind === 'none' ? NO_COLORING : selection.category}
          onChange={(event) => onColorBy(colorByForCategory(event.target.value, radiusM, colorBy))}
        >
          <option value={NO_COLORING}>色分けしない</option>
          {COLOR_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS_JA[category]}
            </option>
          ))}
        </select>
        {selection.kind === 'metric' && (
          <VariantSelect
            selection={selection}
            radiusM={radiusM}
            colorBy={colorBy}
            onColorBy={onColorBy}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 text-xs font-medium text-slate-400">駅の周り</span>
        <RadiusButtons value={radiusM} onChange={onRadius} />
      </div>
    </div>
  )
}
