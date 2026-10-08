/**
 * データの更新でしか変わらない一覧を、サーバの中でしばらく持つ（2026-10-08 B2 でまとめた）。
 *
 * 路線・会社の名前の索引（`src/ai/routes/catalog.ts`）、会社の表示名（`src/domain/operators.ts`）、
 * 全駅の索引（`src/ai/area/catalog.ts`）が同じ持ち方をする：
 * - 期限（`ttl_ms`）のあいだは同じ結果（読み込み中なら同じ Promise）を返す
 * - **読めなかったときは持たない**（次の呼び出しで読み直す）。呼び出し側へは元の失敗がそのまま届く
 */

export type TtlCache<T> = {
  /** 持っている結果（期限切れ・まだ無ければ読み込む）。`now_ms` はテストで時刻を進めるため。 */
  readonly get: (now_ms?: number) => Promise<T>
  /** 持っている結果を捨てる（テストと、データを入れ替えたあとの読み直し）。 */
  readonly clear: () => void
}

type Entry<T> = { readonly loadedAt_ms: number; readonly value: Promise<T> }

export function ttlCache<T>(load: () => Promise<T>, ttl_ms: number): TtlCache<T> {
  const state: { entry: Entry<T> | null } = { entry: null }
  const get = (now_ms: number = Date.now()): Promise<T> => {
    const entry = state.entry
    if (entry !== null && now_ms - entry.loadedAt_ms < ttl_ms) return entry.value
    const value = load()
    state.entry = { loadedAt_ms: now_ms, value }
    value.catch(() => {
      if (state.entry?.value === value) state.entry = null
    })
    return value
  }
  return { get, clear: () => (state.entry = null) }
}
