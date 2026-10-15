'use client'

/**
 * エリアの一覧（`GET /api/areas`・行政区域 1,961）の取得フック（SWR・エリアを選ぶときだけ・2026-10-15 B5e）。
 * 応答は約 430KB（gzip で約 42KB）で、データの更新でしか変わらない（サーバも 1 日キャッシュ）。
 */

import useSWR from 'swr'
import { areasResponseSchema, type AreaCatalogEntry } from '@/shared/area-summary'
import { fetchJson } from '@/lib/fetch-json'

const ENDPOINT = '/api/areas'
const FETCH_TIMEOUT_MS = 15_000
const DEDUPING_INTERVAL_MS = 60 * 60 * 1000

async function fetchCatalog(url: string): Promise<readonly AreaCatalogEntry[]> {
  const response = await fetchJson(url, areasResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: 'エリアの一覧を取得できませんでした',
  })
  return response.areas
}

export type AreaCatalogState = {
  readonly entries: readonly AreaCatalogEntry[]
  readonly isLoading: boolean
  readonly error: Error | undefined
}

export function useAreaCatalog(enabled: boolean): AreaCatalogState {
  const { data, error, isLoading } = useSWR(enabled ? ENDPOINT : null, fetchCatalog, {
    revalidateOnFocus: false,
    dedupingInterval: DEDUPING_INTERVAL_MS,
  })
  return {
    entries: data ?? [],
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
