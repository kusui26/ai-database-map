/**
 * 最小の LRU キャッシュ（依存なし・**Promise を入れて同時取得を畳む**）。
 *
 * 同じ 250m メッシュ・同じタイルへの問い合わせは短時間に固まる（地図を少し動かした・
 * 現在地が数 m 動いた）。ここで畳まないと、外部 API のレート制限（浸水ナビは
 * **分間 30 リクエスト**）をすぐ使い切る（`docs/260824_flood.md` §6.3）。
 *
 * ⚠ サーバレスではインスタンスごとのメモリなので**厳密な全体キャッシュではない**。
 * CDN の `Cache-Control` が本体で、これはその下の 2 段目にあたる。
 */

export type Lru<K, V> = {
  readonly get: (key: K) => V | undefined
  readonly set: (key: K, value: V) => void
  readonly remove: (key: K) => void
  readonly size: () => number
  readonly clear: () => void
}

/**
 * 容量つきの LRU。`Map` は挿入順を保つので、**取り出すたびに入れ直す**だけで
 * 「最後に使ったものが末尾」になり、追い出すのは先頭でよい。
 */
export function createLru<K, V>(capacity: number): Lru<K, V> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`LRU の容量は 1 以上の整数（受領: ${capacity}）`)
  }
  const store = new Map<K, V>()
  return {
    get: (key) => {
      if (!store.has(key)) return undefined
      const value = store.get(key)
      store.delete(key)
      if (value !== undefined) store.set(key, value)
      return value
    },
    set: (key, value) => {
      store.delete(key)
      store.set(key, value)
      const oldest = store.keys().next()
      if (store.size > capacity && !oldest.done) store.delete(oldest.value)
    },
    remove: (key) => void store.delete(key),
    size: () => store.size,
    clear: () => store.clear(),
  }
}

/**
 * キャッシュに無ければ `load` を走らせて**その Promise を先に載せる**。
 * 同じキーの同時アクセスが 1 回の取得に畳まれる。失敗したら覚えない
 * （一度の通信断で、その後ずっと空を返し続けるのを防ぐ）。
 */
export function remember<K, V>(
  cache: Lru<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const pending = load()
  cache.set(key, pending)
  // 失敗は覚えない：一度の通信断で、その後ずっと同じ失敗を返し続けるのを防ぐ。
  // ここで `catch` を付けておくので、呼び出し側が待つ前に落ちても未処理拒否にならない。
  void pending.catch(() => cache.remove(key))
  return pending
}
