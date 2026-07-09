'use client'

/**
 * ランキングのモーダル（FAB から開く・P6c 改善）。複数県×指標（半径付き）×上位下位×⚠除外。
 * /api/ranking をページング（もっと見る）で全件まで。行クリックで駅選択（?grp）＝flyTo＋詳細。
 */

import { useCallback, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { type Order } from '@/shared/api'
import { type Category } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { DEFAULT_RANKING_KEY, rankableGroups } from '@/domain/metrics'
import { rankingPanel } from '@/domain/ranking/panel'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { RankingTable } from '@/components/panels/RankingTable'
import { MetricPicker } from './MetricPicker'
import { useRanking } from './useRanking'

const DEFAULT_CATEGORY: Category = getEntry(DEFAULT_RANKING_KEY)?.category ?? 'population'

export function RankingDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { setGrp } = useMapUrlState()
  const [category, setCategory] = useState<Category>(DEFAULT_CATEGORY)
  const [metricKey, setMetricKey] = useState<string>(DEFAULT_RANKING_KEY)
  const [prefectures, setPrefectures] = useState<string[]>([])
  const [order, setOrder] = useState<Order>('desc')
  const [excludeLowN, setExcludeLowN] = useState<boolean>(false)

  const { ranking, total, isLoading, isLoadingMore, canLoadMore, loadMore, error } = useRanking(
    metricKey,
    prefectures,
    order,
    excludeLowN,
    open,
  )

  const onCategory = useCallback((next: Category) => {
    setCategory(next)
    const firstKey = rankableGroups(next)[0]?.entries[0]?.key
    if (firstKey !== undefined) setMetricKey(firstKey)
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
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">ランキング</Dialog.Title>
            <Dialog.Close
              aria-label="閉じる"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="border-b border-slate-100 px-4 py-3">
            <MetricPicker
              category={category}
              metricKey={metricKey}
              prefectures={prefectures}
              order={order}
              excludeLowN={excludeLowN}
              onCategory={onCategory}
              onMetric={setMetricKey}
              onPrefectures={setPrefectures}
              onOrder={setOrder}
              onExcludeLowN={setExcludeLowN}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {error !== undefined ? (
              <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
                ランキングを取得できませんでした。時間をおいて再度お試しください。
              </div>
            ) : ranking === undefined ? (
              <div className="grid h-40 place-items-center text-sm text-slate-400">
                {isLoading ? '集計中…' : '指標を選んでください'}
              </div>
            ) : (
              <RankingTable panel={rankingPanel(ranking)} onSelect={onSelect} />
            )}
          </div>

          {ranking !== undefined && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-sm">
              <span className="text-slate-400 tabular-nums">
                {ranking.rows.length} / {total} 件
              </span>
              {canLoadMore && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50"
                >
                  {isLoadingMore ? '読み込み中…' : 'もっと見る'}
                </button>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
