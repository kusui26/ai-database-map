'use client'

/** 路線の一覧（/api/routes）の取得フック（SWR・セレクタを開いたときだけ・260731）。 */

import useSWR from 'swr'
import { type Route, routesResponseSchema } from '@/shared/api'

const FETCH_TIMEOUT_MS = 10_000

async function fetchRoutes(url: string): Promise<readonly Route[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`路線の取得に失敗しました (HTTP ${response.status})`)
    return routesResponseSchema.parse(await response.json()).routes
  } finally {
    clearTimeout(timer)
  }
}

export type RoutesState = {
  readonly routes: readonly Route[]
  readonly isLoading: boolean
  readonly error: Error | undefined
}

export function useRoutes(enabled: boolean): RoutesState {
  const { data, error, isLoading } = useSWR(enabled ? '/api/routes' : null, fetchRoutes, {
    revalidateOnFocus: false,
    // 路線一覧はデータ更新でしか変わらない（サーバ側も 1 日キャッシュ）。
    dedupingInterval: 60 * 60 * 1000,
  })
  return {
    routes: data ?? [],
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
