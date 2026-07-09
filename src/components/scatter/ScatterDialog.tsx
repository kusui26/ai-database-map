'use client'

/**
 * 散布図のモーダル（FAB から開く）。x/y 指標ピッカ × 都道府県 × 低分母除外 → /api/growth
 * （決定的 k-means 済み）→ Chart.js 散布（クラスタ色分け）。点クリックで駅選択（?grp）。
 */

import { useCallback, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { type Category } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { DEFAULT_SCATTER_X, DEFAULT_SCATTER_Y, rankableGroups } from '@/domain/metrics'
import { scatterPanel } from '@/domain/growth/panel'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { ScatterChart } from '@/components/panels/ScatterChart'
import { MetricSelect } from '@/components/metrics/MetricSelect'
import { PrefectureMultiSelect } from '@/components/metrics/PrefectureMultiSelect'
import { useGrowth } from './useGrowth'

const X_CATEGORY: Category = getEntry(DEFAULT_SCATTER_X)?.category ?? 'population'
const Y_CATEGORY: Category = getEntry(DEFAULT_SCATTER_Y)?.category ?? 'passenger'

function firstKeyOf(category: Category): string | undefined {
  return rankableGroups(category)[0]?.entries[0]?.key
}

export function ScatterDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { setGrp } = useMapUrlState()
  const [xCategory, setXCategory] = useState<Category>(X_CATEGORY)
  const [xKey, setXKey] = useState<string>(DEFAULT_SCATTER_X)
  const [yCategory, setYCategory] = useState<Category>(Y_CATEGORY)
  const [yKey, setYKey] = useState<string>(DEFAULT_SCATTER_Y)
  const [prefectures, setPrefectures] = useState<string[]>([])
  const [excludeLowN, setExcludeLowN] = useState<boolean>(false)

  const { growth, isLoading, error } = useGrowth(xKey, yKey, prefectures, excludeLowN, open)

  const onXCategory = useCallback((next: Category) => {
    setXCategory(next)
    const k = firstKeyOf(next)
    if (k !== undefined) setXKey(k)
  }, [])
  const onYCategory = useCallback((next: Category) => {
    setYCategory(next)
    const k = firstKeyOf(next)
    if (k !== undefined) setYKey(k)
  }, [])
  const onSelect = useCallback(
    (grp: string) => {
      void setGrp(grp)
      onOpenChange(false)
    },
    [setGrp, onOpenChange],
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">散布図</Dialog.Title>
            <Dialog.Close
              aria-label="閉じる"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="space-y-2 border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <PrefectureMultiSelect selected={prefectures} onChange={setPrefectures} />
              <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={excludeLowN}
                  onChange={(e) => setExcludeLowN(e.target.checked)}
                  className="size-4 accent-indigo-600"
                />
                低分母（⚠）を除外
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-7 shrink-0 text-xs font-medium text-slate-400">X軸</span>
              <MetricSelect
                ariaPrefix="X軸 "
                category={xCategory}
                metricKey={xKey}
                onCategory={onXCategory}
                onMetric={setXKey}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-7 shrink-0 text-xs font-medium text-slate-400">Y軸</span>
              <MetricSelect
                ariaPrefix="Y軸 "
                category={yCategory}
                metricKey={yKey}
                onCategory={onYCategory}
                onMetric={setYKey}
                className="flex-1"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {error !== undefined ? (
              <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
                散布データを取得できませんでした。時間をおいて再度お試しください。
              </div>
            ) : growth === undefined ? (
              <div className="grid h-40 place-items-center text-sm text-slate-400">
                {isLoading ? '集計中…' : '指標を選んでください'}
              </div>
            ) : (
              <>
                <ScatterChart panel={scatterPanel(growth)} onSelect={onSelect} />
                {growth.excludedLowN > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    低分母（信頼性フラグ）の {growth.excludedLowN} 駅を除外しています。
                  </p>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
