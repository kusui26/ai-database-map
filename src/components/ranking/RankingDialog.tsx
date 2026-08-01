'use client'

/**
 * ランキングのモーダル（FAB から開く・P6c 改善）。
 * 絞り込み（都道府県×運営会社×路線・種別）×指標（半径付き）×上位下位×⚠除外。
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
import { useStationFilters } from '@/components/metrics/useStationFilters'
import { MetricPicker } from './MetricPicker'
import { useRanking } from './useRanking'

const DEFAULT_CATEGORY: Category = getEntry(DEFAULT_RANKING_KEY)?.category ?? 'population'

/** チャットからの昇格で初期指標・条件を preset する（未指定は既定）。 */
export type RankingInitial = {
  readonly metricKey: string
  readonly prefectures: readonly string[]
  /** 運営会社・路線・事業者種別の絞り込み（260801・省略時は絞らない）。 */
  readonly operators?: readonly string[]
  readonly routes?: readonly string[]
  readonly routeTypes?: readonly number[]
  readonly order: Order
  readonly excludeLowN: boolean
}

export function RankingDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: RankingInitial
}) {
  const { setGrp } = useMapUrlState()
  const initialKey = initial?.metricKey ?? DEFAULT_RANKING_KEY
  const [category, setCategory] = useState<Category>(
    getEntry(initialKey)?.category ?? DEFAULT_CATEGORY,
  )
  const [metricKey, setMetricKey] = useState<string>(initialKey)
  // 絞り込みと連動は散布と共有する（260801）。
  const filters = useStationFilters(open, initial)
  const [order, setOrder] = useState<Order>(initial?.order ?? 'desc')
  // 既定で信頼性の低い値（⚠）を除外する。散布（PR #40）と揃え、同じデータを見ているのに
  // 2 画面で母集団が違う、という食い違いを無くす（チャットからの昇格は initial 優先）。
  const [excludeLowN, setExcludeLowN] = useState<boolean>(initial?.excludeLowN ?? true)

  const { ranking, total, isLoading, isLoadingMore, canLoadMore, loadMore, error } = useRanking(
    { metric: metricKey, ...filters.values, order, excludeLowN },
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
          className="fixed top-1/2 left-1/2 z-50 flex h-[86vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">ランキング</Dialog.Title>
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

          <div className="border-b border-slate-100 px-4 py-3">
            <MetricPicker
              category={category}
              metricKey={metricKey}
              filters={filters}
              order={order}
              excludeLowN={excludeLowN}
              onCategory={onCategory}
              onMetric={setMetricKey}
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
              <div className="grid h-full place-items-center text-sm text-slate-400">
                {isLoading ? '集計中…' : '指標を選んでください'}
              </div>
            ) : (
              <RankingTable panel={rankingPanel(ranking)} onSelect={onSelect} />
            )}
          </div>

          {ranking !== undefined && (
            <div className="grid grid-cols-3 items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-sm">
              <span className="text-slate-400 tabular-nums">
                {ranking.rows.length} / {total} 件
              </span>
              <div className="flex justify-center">
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
              <span aria-hidden />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
