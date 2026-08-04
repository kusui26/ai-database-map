'use client'

/**
 * 重いチャンクを、初期表示の邪魔にならない時機に先読みする（260805）。
 *
 * ランキング／散布のモーダルは 6 本 166KB あり、これを**クリックしてから**取得していた。
 * ローカルでは 130ms で済むが、**4G 相当で 1,342ms・3G 相当で 9,193ms** かかる
 * （docs/260804_loading_map.md §4.3）。取得を待つあいだ操作できないので、先に取っておく。
 *
 * 「邪魔にならない時機」は 2 段構えで判定する：
 *   1. **地図が使えるようになってから**（`mapStore.ready`）
 *   2. さらにメインスレッドがアイドルになってから
 *
 * 1 を `load` イベントにしていたときは、**LCP が 256ms 悪化した**（4G 相当・各 5 回で
 * 1,504ms → 1,760ms）。地図のスタイルと駅データは JS から取りに行くので `load` を
 * ブロックせず、`load` 時点ではまだ帯域を使っている最中だったため。
 */

import { useEffect } from 'react'

/** アイドルにならないまま待ち続けないための上限。 */
const IDLE_TIMEOUT_MS = 3_000

/** 先読みを見送る回線（`navigator.connection` は未実装のブラウザがある）。 */
const SKIP_EFFECTIVE_TYPES: readonly string[] = ['slow-2g', '2g']

type NetworkInformation = {
  readonly saveData?: boolean
  readonly effectiveType?: string
}

function isNetworkInformation(value: unknown): value is NetworkInformation {
  return typeof value === 'object' && value !== null
}

/**
 * 通信量を節約すべき状況か。データセーバー時と 2G 相当では、
 * 先読みが「今見ているもの」の取得を遅らせるほうが害になるため見送る。
 */
function shouldSkipPrefetch(): boolean {
  if (!('connection' in navigator)) return false
  const connection: unknown = navigator.connection
  if (!isNetworkInformation(connection)) return false
  if (connection.saveData === true) return true
  const type = connection.effectiveType
  return type !== undefined && SKIP_EFFECTIVE_TYPES.includes(type)
}

/** メインスレッドがアイドルになったら実行する（未対応ブラウザはタイマで代替）。戻り値は解除関数。 */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback !== 'function') {
    const timer = window.setTimeout(run, IDLE_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }
  const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS })
  return () => window.cancelIdleCallback(handle)
}

/**
 * 渡された動的 import を、`enabled` になったあとのアイドル時間に呼んでチャンクを取得しておく。
 *
 * @param loaders 参照が安定している必要がある（モジュール定数を渡すこと）
 * @param enabled 初期表示が終わったか。`false` のあいだは何もしない
 */
export function usePrefetchOnIdle(
  loaders: readonly (() => Promise<unknown>)[],
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || shouldSkipPrefetch()) return
    return whenIdle(() => {
      // 失敗してもクリック時に取り直せるので握りつぶす（未処理の rejection を防ぐ）。
      loaders.forEach((load) => void load().catch(() => undefined))
    })
  }, [loaders, enabled])
}
