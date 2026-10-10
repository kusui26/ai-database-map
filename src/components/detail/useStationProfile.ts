'use client'

/**
 * 駅周辺のプロフィール（`/api/stations/[grp]/profile?radiusM=`）の取得フック（SWR・2026-10-09 B4）。
 * 位置（県内・市内の順位）は半径で変わるので、キーは駅と半径。半径を替えても前の表示を残す（ちらつかせない）。
 */

import useSWR from 'swr'
import { stationProfileSchema, type StationProfile } from '@/shared/api'
import { fetchJson } from '@/lib/fetch-json'

const FETCH_TIMEOUT_MS = 10_000

function fetchStationProfile(url: string): Promise<StationProfile> {
  return fetchJson(url, stationProfileSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '駅周辺のプロフィールを取得できませんでした',
  })
}

/** API の URL（駅の grp は `#` を含むので必ずエンコードする）。 */
export function stationProfileUrl(grp: string, radiusM: number): string {
  return `/api/stations/${encodeURIComponent(grp)}/profile?radiusM=${radiusM}`
}

export type StationProfileState = {
  readonly profile: StationProfile | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** grp（null＝未選択）と半径からプロフィールを取得する。 */
export function useStationProfile(grp: string | null, radiusM: number): StationProfileState {
  const key = grp === null ? null : stationProfileUrl(grp, radiusM)
  const { data, error, isLoading } = useSWR(key, fetchStationProfile, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 60_000,
  })
  return {
    profile: data,
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
