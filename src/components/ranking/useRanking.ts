'use client'

/** ランキング（/api/ranking）の取得フック（SWR Infinite・ページング＝もっと見る・P6c）。 */

import useSWRInfinite from 'swr/infinite'
import { type Order, type RankingResponse, rankingResponseSchema } from '@/shared/api'

const PAGE_SIZE = 50
const FETCH_TIMEOUT_MS = 12_000

async function fetchRankingPage(url: string): Promise<RankingResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`ランキングの取得に失敗しました (HTTP ${response.status})`)
    return rankingResponseSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

export type RankingState = {
  readonly ranking: RankingResponse | undefined // rows は全ページ累積
  readonly total: number
  readonly isLoading: boolean
  readonly isLoadingMore: boolean
  readonly canLoadMore: boolean
  readonly loadMore: () => void
  readonly error: Error | undefined
}

/** ランキングの条件（そのままクエリ文字列になる・空配列＝絞らない）。 */
export type RankingQuery = {
  readonly metric: string
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
  readonly order: Order
  readonly excludeLowN: boolean
}

/** 条件＋ページ番号 → リクエスト URL（絞っていない軸は載せない＝キャッシュが効く）。 */
export function rankingUrl(query: RankingQuery, pageIndex: number): string {
  const params = new URLSearchParams({
    metric: query.metric,
    order: query.order,
    limit: String(PAGE_SIZE),
    offset: String(pageIndex * PAGE_SIZE),
  })
  if (query.prefectures.length > 0) params.set('prefecture', query.prefectures.join(','))
  if (query.operators.length > 0) params.set('operators', query.operators.join(','))
  if (query.routes.length > 0) params.set('routes', query.routes.join(','))
  if (query.routeTypes.length > 0) params.set('routeTypes', query.routeTypes.join(','))
  if (query.excludeLowN) params.set('excludeLowN', 'true')
  return `/api/ranking?${params.toString()}`
}

export function useRanking(query: RankingQuery, enabled: boolean): RankingState {
  const getKey = (pageIndex: number, previous: RankingResponse | null): string | null => {
    if (!enabled) return null
    if (previous !== null && previous.rows.length < PAGE_SIZE) return null // 末尾に到達
    return rankingUrl(query, pageIndex)
  }

  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(
    getKey,
    fetchRankingPage,
    { revalidateFirstPage: false, revalidateOnFocus: false },
  )

  const pages = data ?? []
  const first = pages[0]
  const rows = pages.flatMap((page) => page.rows)
  const total = first?.total ?? 0
  const ranking = first === undefined ? undefined : { ...first, rows }
  const isLoadingMore = isValidating && pages.length > 0 && pages.length < size

  return {
    ranking,
    total,
    isLoading,
    isLoadingMore,
    canLoadMore: rows.length < total,
    loadMore: () => void setSize(size + 1),
    error: error instanceof Error ? error : undefined,
  }
}
