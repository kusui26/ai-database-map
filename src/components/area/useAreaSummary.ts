'use client'

/**
 * エリアの要約（`GET /api/areas/summary?area=…&radiusM=&colorBy=`）の取得フック（SWR・2026-10-15 B5e）。
 *
 * 区域の値・駅の分布・内訳・比較・色分けの凡例はすべてサーバが決める（`src/domain/area-summary/`）。ここは条件で取って検証するだけ。
 * 条件を替えた直後も、前の応答を持ち続ける（`latest`）——エリアの札の名前と図をちらつかせない。いまの条件の応答は `summary`
 * （地図の色分けは、いまの条件の応答だけで書く）。4xx（知らないエリア・壊れた形）は叩き直さない（`SwrProvider`）。
 */

import useSWR from 'swr'
import { areaSummaryResponseSchema, type AreaSummaryResponse } from '@/shared/area-summary'
import { fetchJson } from '@/lib/fetch-json'

/** 全国の要約でも 1 秒前後（2026-10-15 実測）。通信の遅い携帯を見込んで長めに。 */
const FETCH_TIMEOUT_MS = 20_000
/** 同じ条件を取り直さない間隔（区域の値はデータの更新でしか変わらない）。 */
const DEDUPING_INTERVAL_MS = 60_000

/** 要約の条件（`colorBy` の null＝既定の色分け）。 */
export type AreaSummaryQuery = {
  readonly areas: readonly string[]
  readonly radiusM: number
  readonly colorBy: string | null
}

/** API の URL（エリアは `area` を繰り返す。範囲の `,`・起点の `#` は URLSearchParams がエンコードする）。 */
export function areaSummaryUrl(query: AreaSummaryQuery): string {
  const params = new URLSearchParams([
    ...query.areas.map((area): [string, string] => ['area', area]),
    ['radiusM', String(query.radiusM)],
    ...(query.colorBy === null ? [] : [['colorBy', query.colorBy] satisfies [string, string]]),
  ])
  return `/api/areas/summary?${params.toString()}`
}

/** 取得した応答と、その URL（前の条件の応答かを見分ける）。 */
type Fetched = { readonly url: string; readonly response: AreaSummaryResponse }

async function fetchSummary(url: string): Promise<Fetched> {
  const response = await fetchJson(url, areaSummaryResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: 'エリアの要約を取得できませんでした',
  })
  return { url, response }
}

export type AreaSummaryState = {
  /** いまの条件の応答（届くまでは undefined）。 */
  readonly summary: AreaSummaryResponse | undefined
  /** 最後に届いた応答（条件を替えた直後は前の条件のもの）。 */
  readonly latest: AreaSummaryResponse | undefined
  /** いまの条件の応答を待っている。 */
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** 条件（エリアが空・表示していなければ取得しない）から要約を取得する。 */
export function useAreaSummary(query: AreaSummaryQuery, active: boolean): AreaSummaryState {
  const url = active && query.areas.length > 0 ? areaSummaryUrl(query) : null
  const { data, error } = useSWR(url, fetchSummary, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: DEDUPING_INTERVAL_MS,
  })
  const summary = data !== undefined && data.url === url ? data.response : undefined
  const failure = error instanceof Error ? error : undefined
  return {
    summary,
    latest: data?.response,
    isLoading: url !== null && summary === undefined && failure === undefined,
    error: failure,
  }
}
