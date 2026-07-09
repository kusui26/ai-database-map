'use client'

/** 散布（/api/growth）の取得フック（SWR）。open 中のみ・x/y/都道府県/除外の変更で再取得。 */

import useSWR from 'swr'
import { type GrowthResponse, growthResponseSchema } from '@/shared/api'

const FETCH_TIMEOUT_MS = 15_000

async function fetchGrowth(url: string): Promise<GrowthResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`散布データの取得に失敗しました (HTTP ${response.status})`)
    return growthResponseSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

export type GrowthState = {
  readonly growth: GrowthResponse | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

export function useGrowth(
  x: string,
  y: string,
  prefectures: string[],
  excludeLowN: boolean,
  enabled: boolean,
): GrowthState {
  const params = new URLSearchParams({ x, y })
  if (prefectures.length > 0) params.set('prefecture', prefectures.join(','))
  if (excludeLowN) params.set('excludeLowN', 'true')
  const key = enabled ? `/api/growth?${params.toString()}` : null

  const { data, error, isLoading } = useSWR(key, fetchGrowth, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 60_000,
  })
  return { growth: data, isLoading, error: error instanceof Error ? error : undefined }
}
