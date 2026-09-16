'use client'

/**
 * おすすめ駅（`/api/recommend`）の取得フック。
 *
 * ## 失敗の文言はサーバのものをそのまま出す
 *
 * API の 400 は「エリアを絞ってください」「weights に知らない指標名があります」のように、
 * **人が読んで次の一手が分かる**日本語で返る。ここで「取得に失敗しました」に丸めると、
 * その情報が消える。エラー封筒を読んで、そのまま画面へ渡す。
 *
 * ## 直前の結果を残したまま取りに行く
 *
 * 重みスライダは動かすたびに再計算になる。毎回表が空になると順位の動きが読めないので、
 * `keepPreviousData` で前の表を残し、更新中であることだけを示す。
 */

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { recommendResponseSchema, type RecommendResponse } from '@/shared/api'
import { fetchJson, messageJaOf } from '@/lib/fetch-json'
import { recommendUrl, type RecommendCriteria } from './query'

const FETCH_TIMEOUT_MS = 20_000
/** スライダを動かしている間は投げない（1 ドラッグで何十回も叩かないため）。 */
export const DEBOUNCE_MS = 350

function fetchRecommend(url: string): Promise<RecommendResponse> {
  return fetchJson(url, recommendResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: 'おすすめを取得できませんでした',
  })
}

/** 値が落ち着いてから返す（入力のたびに走らせないため）。 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

export type RecommendState = {
  readonly data: RecommendResponse | undefined
  /** まだ 1 度も表が出ていない。 */
  readonly isLoading: boolean
  /** 表は出ているが、新しい条件で取り直している。 */
  readonly isRefreshing: boolean
  /** サーバが返した日本語（そのまま表示する）。 */
  readonly errorJa: string | undefined
}

/** `active` が false の間は取得しない（モーダルを開いたときだけ）。 */
export function useRecommend(criteria: RecommendCriteria, active: boolean): RecommendState {
  const url = useDebounced(recommendUrl(criteria), DEBOUNCE_MS)
  // 再試行の方針はアプリ全体で 1 つ（`SwrProvider`）。ここに個別設定を置かない。
  const { data, error, isLoading, isValidating } = useSWR(active ? url : null, fetchRecommend, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return {
    data,
    isLoading: isLoading && data === undefined,
    isRefreshing: isValidating && data !== undefined,
    errorJa: error === undefined ? undefined : messageJaOf(error, 'おすすめを取得できませんでした'),
  }
}
