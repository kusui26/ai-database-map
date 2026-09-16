'use client'

/**
 * 市区町村の選択肢（`/api/stations?prefecture=…` の駅一覧から組み立てる）。
 *
 * 専用のエンドポイントは作らない——駅一覧に市区町村が入っているので、既にある共通 API で足りる
 * （CLAUDE.md §2「AI と人間で別 API を作らない」）。都道府県を 1 つに絞ったときだけ取りに行く。
 */

import useSWR from 'swr'
import { z } from 'zod'
import { stationListItemSchema } from '@/shared/api'
import { fetchJson } from '@/lib/fetch-json'
import { municipalityOptions, type MunicipalityOption } from './municipalities'

const FETCH_TIMEOUT_MS = 12_000
/** 1 都道府県の駅数は最多でも 654（東京都）。上限は余裕を持たせる。 */
const STATION_LIMIT = 2000

const listSchema = z.array(stationListItemSchema)

async function fetchOptions(url: string): Promise<readonly MunicipalityOption[]> {
  const stations = await fetchJson(url, listSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '市区町村を取得できませんでした',
  })
  return municipalityOptions(stations)
}

export type MunicipalitiesState = {
  readonly options: readonly MunicipalityOption[]
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** 都道府県をちょうど 1 つ選んでいるときだけ取得する（`null`＝取得しない）。 */
export function useMunicipalities(prefecture: string | null): MunicipalitiesState {
  const key =
    prefecture === null
      ? null
      : `/api/stations?prefecture=${encodeURIComponent(prefecture)}&limit=${STATION_LIMIT}`
  const { data, error, isLoading } = useSWR(key, fetchOptions, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 60 * 1000,
  })
  return {
    options: data ?? [],
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
