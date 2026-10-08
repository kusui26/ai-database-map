'use client'

/** 路線（運行系統）の一覧（/api/lines）の取得フック（SWR・セレクタを開いたときだけ・2026-10-08 L4）。 */

import useSWR from 'swr'
import { type Line, linesResponseSchema } from '@/shared/api'
import { fetchJson } from '@/lib/fetch-json'

const FETCH_TIMEOUT_MS = 10_000

/** 一覧はデータ更新でしか変わらない（サーバ側も 1 日キャッシュ）。 */
const DEDUPING_INTERVAL_MS = 60 * 60 * 1000

async function fetchLines(url: string): Promise<readonly Line[]> {
  const response = await fetchJson(url, linesResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '路線を取得できませんでした',
  })
  return response.lines
}

export type LinesState = {
  readonly lines: readonly Line[]
  readonly isLoading: boolean
  readonly error: Error | undefined
}

export function useLines(enabled: boolean): LinesState {
  const { data, error, isLoading } = useSWR(enabled ? '/api/lines' : null, fetchLines, {
    revalidateOnFocus: false,
    dedupingInterval: DEDUPING_INTERVAL_MS,
  })
  return {
    lines: data ?? [],
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
