'use client'

/**
 * ランキングの中身（絞り込み・指標ピッカ・表・ページング）。**枠を持たない**ので、
 * モーダル（`RankingDialog`）とチャットのキャンバス（`ChatCanvas`）の両方に置ける
 * （`StationDetailPanel` が `DetailBody` を共用しているのと同じ形・260802）。
 *
 * /api/ranking をページング（もっと見る）で全件まで。行クリックは `onSelect` に委ねる。
 *
 * 条件は**開いた図**（URL の `?fig`・`figure/url.ts`）から始め、変えたら `onConditions` で知らせる
 * （入れ物が URL へ書き戻す＝戻る・進む・リロードで同じ条件の表が出る・2026-10-02）。
 */

import { useCallback, useEffect, useState } from 'react'
import { type Order } from '@/shared/api'
import { type Category } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { DEFAULT_RANKING_KEY, rankableGroups } from '@/domain/metrics'
import { rankingPanel } from '@/domain/ranking/panel'
import { RankingTable } from '@/components/panels/RankingTable'
import { useStationFilters } from '@/components/metrics/useStationFilters'
import { type RankingFigure } from '@/components/figure/url'
import { MetricPicker } from './MetricPicker'
import { useRanking } from './useRanking'
import { messageJaOf } from '@/lib/fetch-json'

const DEFAULT_CATEGORY: Category = getEntry(DEFAULT_RANKING_KEY)?.category ?? 'population'

/** 開いた図の指標。無い・カタログに無い（手で書き換えた URL など）なら既定の指標。 */
function initialMetricKey(figure: RankingFigure): string {
  const key = figure.metricKey
  return key !== null && getEntry(key) !== undefined ? key : DEFAULT_RANKING_KEY
}

export function RankingBody({
  initial,
  active,
  onSelect,
  onConditions,
}: {
  /** 開いた図（条件の初期値）。FAB で開いた直後は指標が null＝既定の指標。 */
  initial: RankingFigure
  /** 表示中か（false の間は取得しない。モーダルの open／キャンバスの表示状態）。 */
  active: boolean
  onSelect: (grp: string) => void
  /** 条件が変わったら呼ぶ（開いた直後の既定の補完を含む）。入れ物が URL へ書き戻す。 */
  onConditions?: (figure: RankingFigure) => void
}) {
  const initialKey = initialMetricKey(initial)
  const [category, setCategory] = useState<Category>(
    getEntry(initialKey)?.category ?? DEFAULT_CATEGORY,
  )
  const [metricKey, setMetricKey] = useState<string>(initialKey)
  // 絞り込みと連動は散布と共有する（260801）。
  const filters = useStationFilters(active, initial)
  const [order, setOrder] = useState<Order>(initial.order)
  // 既定で信頼性の低い値（⚠）を除外する。散布（PR #40）と揃え、同じデータを見ているのに
  // 2 画面で母集団が違う、という食い違いを無くす（チャットからの昇格は AI が使った条件を優先）。
  const [excludeLowN, setExcludeLowN] = useState<boolean>(initial.excludeLowN)

  const { prefectures, operators, routes, routeTypes, lines } = filters.values
  useEffect(() => {
    onConditions?.({
      kind: 'ranking',
      metricKey,
      order,
      prefectures,
      operators,
      routes,
      routeTypes,
      lines,
      excludeLowN,
    })
  }, [
    onConditions,
    metricKey,
    order,
    prefectures,
    operators,
    routes,
    routeTypes,
    lines,
    excludeLowN,
  ])

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
          lineNames={ranking?.lines ?? []}
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
            {messageJaOf(
              error,
              'ランキングを取得できませんでした。時間をおいて再度お試しください。',
            )}
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
