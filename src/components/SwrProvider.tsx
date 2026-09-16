'use client'

/**
 * 取得に失敗したときの振る舞いを、**アプリ全体で 1 つ**に決める（`docs/260916_ops_guard.md` G2）。
 *
 * ## 4xx は叩き直さない
 *
 * SWR の既定は「エラーなら再試行（**回数の上限なし**）」。間隔は指数バックオフなので暴走は
 * しないが、**4xx は何度やっても同じ**である。400 は条件を直さない限り 400 のままだし、
 * 429 に至っては**叩き直すこと自体が原因**——「約 19 秒待ってください」と表示しながら
 * 裏で再試行するのは、自分の待ち時間を自分で延ばしている。
 *
 * ## 5xx と通信断は 2 回まで
 *
 * こちらは待てば直る類なので拾う。ただし上限なしは行き過ぎなので 2 回に切る。
 * 間隔は SWR の既定（指数バックオフ）をそのまま使う——**再実装しない**。
 *
 * ## フックごとに書かない
 *
 * 12 か所に同じ設定を配ると、次に増えたフックで忘れる。実際、W5 の時点で
 * `useRecommend` だけが `shouldRetryOnError: false` を持っていた（1 つだけ直した形跡）。
 */

import { type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { isClientError } from '@/lib/fetch-json'

/** 通信のゆらぎだけを拾う回数（SWR の既定は上限なし）。 */
export const ERROR_RETRY_COUNT = 2

/** 再試行してよい失敗か（4xx は除く）。**判定はここだけ**にあるので、検査もここを見る。 */
export function shouldRetry(error: Error): boolean {
  return !isClientError(error)
}

export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ errorRetryCount: ERROR_RETRY_COUNT, shouldRetryOnError: shouldRetry }}>
      {children}
    </SWRConfig>
  )
}
