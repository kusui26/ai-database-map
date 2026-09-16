'use client'

/** 散布（/api/growth）の取得フック（SWR）。open 中のみ・条件の変更で再取得。 */

import useSWR from 'swr'
import { type GrowthResponse, growthResponseSchema } from '@/shared/api'
import { fetchJson } from '@/lib/fetch-json'

const FETCH_TIMEOUT_MS = 15_000

function fetchGrowth(url: string): Promise<GrowthResponse> {
  return fetchJson(url, growthResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '散布データを取得できませんでした',
  })
}

/** 散布の絞り込み条件（そのままクエリ文字列になる・空配列＝絞らない）。 */
export type GrowthQuery = {
  readonly x: string
  readonly y: string
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
  readonly excludeLowN: boolean
}

export type GrowthState = {
  readonly growth: GrowthResponse | undefined
  readonly isLoading: boolean
  readonly isValidating: boolean // keepPreviousData 中の再取得も true＝「集計中…」表示に使う
  readonly error: Error | undefined
}

/** 条件 → SWR キー（＝リクエスト URL）。絞っていない軸は載せない＝キャッシュが効く。 */
export function growthUrl(query: GrowthQuery): string {
  const params = new URLSearchParams({ x: query.x, y: query.y })
  if (query.prefectures.length > 0) params.set('prefecture', query.prefectures.join(','))
  if (query.operators.length > 0) params.set('operators', query.operators.join(','))
  if (query.routes.length > 0) params.set('routes', query.routes.join(','))
  if (query.routeTypes.length > 0) params.set('routeTypes', query.routeTypes.join(','))
  if (query.excludeLowN) params.set('excludeLowN', 'true')
  return `/api/growth?${params.toString()}`
}

export function useGrowth(query: GrowthQuery, enabled: boolean): GrowthState {
  const { data, error, isLoading, isValidating } = useSWR(
    enabled ? growthUrl(query) : null,
    fetchGrowth,
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      dedupingInterval: 60_000,
    },
  )
  return {
    growth: data,
    isLoading,
    isValidating,
    error: error instanceof Error ? error : undefined,
  }
}
