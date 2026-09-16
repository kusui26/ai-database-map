'use client'

/** 運営会社の一覧（/api/operators）の取得フック（SWR・セレクタを開いたときだけ）。 */

import useSWR from 'swr'
import { type Operator, operatorsResponseSchema } from '@/shared/api'
import { fetchJson } from '@/lib/fetch-json'

const FETCH_TIMEOUT_MS = 10_000

async function fetchOperators(url: string): Promise<readonly Operator[]> {
  const response = await fetchJson(url, operatorsResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '運営会社を取得できませんでした',
  })
  return response.operators
}

export type OperatorsState = {
  readonly operators: readonly Operator[]
  readonly isLoading: boolean
  readonly error: Error | undefined
}

export function useOperators(enabled: boolean): OperatorsState {
  const { data, error, isLoading } = useSWR(enabled ? '/api/operators' : null, fetchOperators, {
    revalidateOnFocus: false,
    // 会社一覧はデータ更新でしか変わらない（サーバ側も 1 日キャッシュ）。
    dedupingInterval: 60 * 60 * 1000,
  })
  return {
    operators: data ?? [],
    isLoading,
    error: error instanceof Error ? error : undefined,
  }
}
