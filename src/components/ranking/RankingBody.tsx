'use client'

/**
 * ランキングの中身（絞り込み・指標ピッカ・表・ページング）。**枠を持たない**ので、
 * モーダル（`RankingDialog`）とチャットのキャンバス（`ChatCanvas`）の両方に置ける
 * （`StationDetailPanel` が `DetailBody` を共用しているのと同じ形・260802）。
 *
 * /api/ranking をページング（もっと見る）で全件まで。行クリックは `onSelect` に委ねる。
 */

import { useCallback, useState } from 'react'
import { type Order } from '@/shared/api'
import { type Category } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { DEFAULT_RANKING_KEY, rankableGroups } from '@/domain/metrics'
import { rankingPanel } from '@/domain/ranking/panel'
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

export function RankingBody({
  initial,
  active,
  onSelect,
}: {
  initial?: RankingInitial
  /** 表示中か（false の間は取得しない。モーダルの open／キャンバスの表示状態）。 */
  active: boolean
  onSelect: (grp: string) => void
}) {
  const initialKey = initial?.metricKey ?? DEFAULT_RANKING_KEY
  const [category, setCategory] = useState<Category>(
    getEntry(initialKey)?.category ?? DEFAULT_CATEGORY,
  )
  const [metricKey, setMetricKey] = useState<string>(initialKey)
  // 絞り込みと連動は散布と共有する（260801）。
  const filters = useStationFilters(active, initial)
  const [order, setOrder] = useState<Order>(initial?.order ?? 'desc')
  // 既定で信頼性の低い値（⚠）を除外する。散布（PR #40）と揃え、同じデータを見ているのに
  // 2 画面で母集団が違う、という食い違いを無くす（チャットからの昇格は initial 優先）。
  const [excludeLowN, setExcludeLowN] = useState<boolean>(initial?.excludeLowN ?? true)

  const { ranking, total, isLoading, isLoadingMore, canLoadMore, loadMore, error } = useRanking(
    { metric: metricKey, ...filters.values, order, excludeLowN },
    active,
  )

  const onCategory = useCallback((next: Category) => {
    setCategory(next)
    const firstKey = rankableGroups(next)[0]?.entries[0]?.key
    if (firstKey !== undefined) setMetricKey(firstKey)
  }, [])

  return (
    <>
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
    </>
  )
}
