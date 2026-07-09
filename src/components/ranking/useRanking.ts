'use client'

/** ランキング（/api/ranking）の取得フック（SWR）。open 中のみ・picker 変更で再取得。 */

import useSWR from 'swr'
import { type Order, type RankingResponse, rankingResponseSchema } from '@/shared/api'

const FETCH_TIMEOUT_MS = 10_000

async function fetchRanking(url: string): Promise<RankingResponse> {
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
  readonly ranking: RankingResponse | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

export function useRanking(
  metric: string,
  prefecture: string | null,
  order: Order,
  enabled: boolean,
): RankingState {
  const params = new URLSearchParams({ metric, order, limit: '20' })
  if (prefecture !== null) params.set('prefecture', prefecture)
  const key = enabled ? `/api/ranking?${params.toString()}` : null

  const { data, error, isLoading } = useSWR(key, fetchRanking, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 60_000,
  })
  return { ranking: data, isLoading, error: error instanceof Error ? error : undefined }
}
