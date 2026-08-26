import { describe, expect, it } from 'vitest'
import { createLru, remember } from '@/lib/lru'

/**
 * 取得のキャッシュ（`src/lib/lru.ts`）。守りたいのは 2 つ。
 * - **同時に同じものを取りに行かない**（浸水ナビは分間 30 リクエストしか許されない）
 * - **失敗を覚えない**（一度の通信断で、その後ずっと同じ失敗を返し続けない）
 */

describe('lru: 容量と追い出し', () => {
  it('最後に使ったものが残り、いちばん古いものが落ちる', () => {
    const cache = createLru<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // a を触ると a が新しくなる
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
    expect(cache.size()).toBe(2)
  })

  it('同じキーの上書きで件数は増えない', () => {
    const cache = createLru<string, number>(2)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.size()).toBe(1)
    expect(cache.get('a')).toBe(2)
  })

  it('容量が 1 未満なら文脈付きで throw', () => {
    expect(() => createLru<string, number>(0)).toThrow(/容量は 1 以上/)
  })
})

describe('lru: remember（同時取得を畳む・失敗は覚えない）', () => {
  it('同じキーの同時アクセスは 1 回の取得に畳まれる', async () => {
    const cache = createLru<string, Promise<number>>(4)
    let calls = 0
    const load = async () => {
      calls += 1
      return 42
    }
    const [first, second] = await Promise.all([
      remember(cache, 'k', load),
      remember(cache, 'k', load),
    ])
    expect([first, second]).toEqual([42, 42])
    expect(calls).toBe(1)
  })

  it('失敗したキーは覚えず、次の呼び出しで取り直す', async () => {
    const cache = createLru<string, Promise<number>>(4)
    let calls = 0
    const load = async () => {
      calls += 1
      if (calls === 1) throw new Error('一時的な通信断')
      return 7
    }
    await expect(remember(cache, 'k', load)).rejects.toThrow('一時的な通信断')
    await expect(remember(cache, 'k', load)).resolves.toBe(7)
    expect(calls).toBe(2)
  })
})
