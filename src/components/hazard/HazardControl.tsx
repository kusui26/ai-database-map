'use client'

/**
 * 災害レイヤの制御（ヘッダのボタン＋その下に開くドロワー）。
 *
 * 「駅を選ぶ」とは別の軸＝**地図のレイヤ**を足す入口（docs/260824_flood.md §7.1）。
 * 選択肢・凡例・出典はすべてカタログとドメインから来るので、レイヤを足しても
 * このファイルは変わらない（既存のカテゴリ追加と同じ体験）。
 *
 * 描き分けの決まり：
 *  - `base`（面をベタ塗り）は同じグループで 1 つだけ → ラジオの見た目
 *  - `overlay`（細い区域・点在）は重ねられる → チェックボックスの見た目
 *  - 「参考：地形」は**ハザードではない**ので、見出しでそう言い、色も分ける（§3.7）
 */

import { useMemo, useState } from 'react'
import { HAZARD_OPACITY_MAX, HAZARD_OPACITY_MIN, HAZARD_GROUP_LABELS_JA } from '@/shared/constants'
import { getHazardLayer } from '@/shared/hazard'
import { hazardGroupViews, hazardLegendSections } from '@/domain/hazard/catalog'
import { useHazardUrlState } from '@/components/map/useHazardUrlState'
import { cn } from '@/lib/utils'
import { HazardLegend } from './HazardLegend'

/** スライダの刻み（0.05＝13 段。細かすぎず、体感で効きが分かる）。 */
const OPACITY_STEP = 0.05

function LayersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 3 3 8l9 5 9-5-9-5Z" strokeLinejoin="round" />
      <path d="m3 13 9 5 9-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** レイヤ 1 件のトグル（base はラジオ・overlay はチェックの見た目）。 */
function LayerToggle({
  layerKey,
  checked,
  onToggle,
}: {
  layerKey: string
  checked: boolean
  onToggle: (key: string) => void
}) {
  const layer = getHazardLayer(layerKey)
  if (layer === undefined) return null
  const isBase = layer.display === 'base'
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(layerKey)}
        aria-pressed={checked}
        title={layer.summaryJa}
        className={cn(
          'flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
          checked ? 'bg-indigo-50 text-indigo-900' : 'text-slate-600 hover:bg-slate-50',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 grid size-3.5 shrink-0 place-items-center border text-[9px] leading-none',
            isBase ? 'rounded-full' : 'rounded-[3px]',
            checked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white',
          )}
        >
          {checked ? (isBase ? '●' : '✓') : ''}
        </span>
        <span className="min-w-0">{layer.labelJa}</span>
      </button>
    </li>
  )
}

/** 不透明度スライダ（0.3–0.9）。背景地図が読めなくなると避難に使えない（§7.6）。 */
function OpacitySlider({
  opacity,
  onChange,
}: {
  opacity: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-slate-500">
      <span className="shrink-0">濃さ</span>
      <input
        type="range"
        min={HAZARD_OPACITY_MIN}
        max={HAZARD_OPACITY_MAX}
        step={OPACITY_STEP}
        value={opacity}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="ハザードレイヤの濃さ"
        className="h-1 w-full accent-indigo-600"
      />
      <span className="w-8 shrink-0 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
    </label>
  )
}

export function HazardControl() {
  const [open, setOpen] = useState(false)
  const { layerKeys, opacity, toggleLayer, setLayerKeys, setOpacity } = useHazardUrlState()
  const groups = useMemo(() => hazardGroupViews(), [])
  const sections = useMemo(() => hazardLegendSections(layerKeys), [layerKeys])
  const activeCount = layerKeys.length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-pressed={open}
        aria-label="災害レイヤを開閉"
        title="災害レイヤ（洪水・内水・高潮・津波・土砂・地形）"
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium shadow-lg ring-1 backdrop-blur transition-colors',
          open || activeCount > 0
            ? 'bg-sky-700 text-white ring-sky-700'
            : 'bg-white/90 text-slate-700 ring-slate-200 hover:bg-white',
        )}
      >
        <LayersIcon />
        <span className="hidden sm:inline">災害</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-xs tabular-nums">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        // ヘッダ（position: absolute）の直下に右揃えで開く。ヘッダが 1 行でも 2 行でも
        // `top-full` が追随するので、ブレークポイントごとの数値を持たなくてよい。
        <div className="pointer-events-auto absolute top-full right-3 z-30 max-h-[calc(100dvh-8rem)] w-[min(21rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl bg-white/95 p-3 shadow-xl ring-1 ring-slate-200 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">災害レイヤ</h2>
            <div className="flex items-center gap-1">
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={() => setLayerKeys([])}
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  すべて消す
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="rounded-md px-1.5 py-0.5 text-sm text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                ×
              </button>
            </div>
          </div>

          <div className="mt-2">
            <OpacitySlider opacity={opacity} onChange={setOpacity} />
          </div>

          <div className="mt-2 space-y-2">
            {groups.map((group) => (
              <div key={group.group}>
                <h3
                  className={cn(
                    'text-[11px] font-semibold',
                    group.group === 'terrain' ? 'text-emerald-700' : 'text-slate-500',
                  )}
                >
                  {HAZARD_GROUP_LABELS_JA[group.group]}
                  {group.group === 'terrain' && (
                    <span className="ml-1 font-normal text-emerald-600">
                      （浸水想定ではありません）
                    </span>
                  )}
                </h3>
                <ul className="mt-0.5">
                  {group.layerKeys.map((key) => (
                    <LayerToggle
                      key={key}
                      layerKey={key}
                      checked={layerKeys.includes(key)}
                      onToggle={toggleLayer}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {sections.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-2">
              <HazardLegend sections={sections} onAddLayer={toggleLayer} />
            </div>
          )}

          {sections.length === 0 && (
            <p className="mt-3 rounded-md bg-slate-100 px-2 py-1.5 text-[11px] leading-4 text-slate-600">
              レイヤを選ぶと、地図に重ねて表示し、ここに凡例と出典を出します。
            </p>
          )}
        </div>
      )}
    </>
  )
}
