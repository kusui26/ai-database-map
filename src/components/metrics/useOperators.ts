'use client'

/** 運営会社の一覧（/api/operators）の取得フック（SWR・セレクタを開いたときだけ）。 */

import useSWR from 'swr'
import { type Operator, operatorsResponseSchema } from '@/shared/api'

const FETCH_TIMEOUT_MS = 10_000

async function fetchOperators(url: string): Promise<readonly Operator[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`運営会社の取得に失敗しました (HTTP ${response.status})`)
    return operatorsResponseSchema.parse(await response.json()).operators
  } finally {
    clearTimeout(timer)
  }
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
