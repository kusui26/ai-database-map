'use client'

/**
 * 駅の色分け（`GET /api/stations/classes?metric=&area=…`）の取得フック（SWR・2026-10-11 B5c）。
 *
 * 分け方・色・凡例の言葉はすべてサーバが決める（`src/domain/style/`）。ここは条件で取って検証するだけ。
 * 4xx（知らない指標・エリア）は叩き直さない（`SwrProvider`）——凡例が API の理由を出す。
 */

import useSWR from 'swr'
import {
  stationClassesResponseSchema,
  type StationClassesResponse,
  type StationColoring,
} from '@/shared/area-summary'
import { fetchJson } from '@/lib/fetch-json'

/** 全国（9,273 駅）は応答が約 560KB（gzip で約 90KB・横浜市は 9KB）。通信の遅い携帯を見込んで長めに。 */
const FETCH_TIMEOUT_MS = 20_000

function fetchStationClasses(url: string): Promise<StationClassesResponse> {
  return fetchJson(url, stationClassesResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '色分けを取得できませんでした',
  })
}

/** API の URL（エリアは `area` を繰り返す。grp の `#` などは URLSearchParams がエンコードする）。 */
export function stationClassesUrl(coloring: StationColoring): string {
  const params = new URLSearchParams([
    ['metric', coloring.metricKey],
    ...coloring.areas.map((area): [string, string] => ['area', area]),
  ])
  return `/api/stations/classes?${params.toString()}`
}

export type StationClassesState = {
  /** いまの条件の結果（条件を替えた直後は、新しい結果が届くまで undefined）。 */
  readonly classes: StationClassesResponse | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** 条件（null＝色分けしない）から色分けを取得する。 */
export function useStationClasses(coloring: StationColoring | null): StationClassesState {
  const key = coloring === null ? null : stationClassesUrl(coloring)
  const { data, error, isLoading } = useSWR(key, fetchStationClasses, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  return {
    classes: data,
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
