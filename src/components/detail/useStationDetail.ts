'use client'

/**
 * 駅詳細（/api/stations/[grp]）の取得フック（SWR）。
 * キーは grp のみ＝半径切替では再フェッチしない（全半径を同梱した詳細を client 側で絞る）。
 */

import useSWR from 'swr'
import { type StationDetail, stationDetailSchema } from '@/shared/api'
import { fetchJson } from '@/lib/fetch-json'

const FETCH_TIMEOUT_MS = 10_000

function fetchStationDetail(url: string): Promise<StationDetail> {
  return fetchJson(url, stationDetailSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '駅詳細を取得できませんでした',
  })
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
