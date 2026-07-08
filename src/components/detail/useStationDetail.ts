'use client'

/**
 * 駅詳細（/api/stations/[grp]）の取得フック（SWR）。
 * キーは grp のみ＝半径切替では再フェッチしない（全半径を同梱した詳細を client 側で絞る）。
 */

import useSWR from 'swr'
import { type StationDetail, stationDetailSchema } from '@/shared/api'

const FETCH_TIMEOUT_MS = 10_000

async function fetchStationDetail(url: string): Promise<StationDetail> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`駅詳細の取得に失敗しました (HTTP ${response.status}): ${url}`)
    }
    const payload: unknown = await response.json()
    return stationDetailSchema.parse(payload)
  } finally {
    clearTimeout(timer)
  }
}

export type StationDetailState = {
  readonly detail: StationDetail | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** grp（null＝未選択）から駅詳細を取得する。 */
export function useStationDetail(grp: string | null): StationDetailState {
  const key = grp === null ? null : `/api/stations/${encodeURIComponent(grp)}`
  const { data, error, isLoading } = useSWR(key, fetchStationDetail, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 60_000,
  })
  return {
    detail: data,
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
