/**
 * 失敗したときに**叩き直すか**、そして**劣化した答えに落ちるか**（260916 G2）。
 *
 * どちらも「弱っている相手に、こちらから追い打ちをかけない」ための規則である。
 * 判定は 2 か所にしか無く（`SwrProvider` と `hazard/fallback`）、ここで固定する。
 */

import { describe, expect, it } from 'vitest'
import { HttpError } from '@/lib/fetch-json'
import { ERROR_RETRY_COUNT, shouldRetry } from '@/components/SwrProvider'
import { shouldFallBackOffline } from '@/components/hazard/fallback'

describe('叩き直すか（SWR の既定は「上限なしで再試行」）', () => {
  it('4xx は 1 度も叩き直さない', () => {
    expect(shouldRetry(new HttpError(400, 'x'))).toBe(false)
    // 429 は**叩き直すこと自体が原因**——待てと言われながら再試行すると待ち時間が延びる。
    expect(shouldRetry(new HttpError(429, 'x'))).toBe(false)
  })

  it('5xx と通信断は拾う（待てば直る類）', () => {
    expect(shouldRetry(new HttpError(503, 'x'))).toBe(true)
    expect(shouldRetry(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('拾う回数には上限がある（既定の「上限なし」を上書きしている）', () => {
    expect(ERROR_RETRY_COUNT).toBeGreaterThan(0)
    expect(ERROR_RETRY_COUNT).toBeLessThanOrEqual(3)
  })
})

describe('メッシュだけの答えに落ちるか', () => {
  /**
   * 落ちた答えには「オフラインのため…」と添う。**オフラインではない理由で落ちると嘘になる。**
   * 上流の制限（G5）を入れたことで、429 は現実に起きる経路になった。
   */
  it('4xx では落ちない（サーバが「いまは答えない」と言っている）', () => {
    expect(shouldFallBackOffline(new HttpError(429, '混雑しています'))).toBe(false)
    expect(shouldFallBackOffline(new HttpError(400, '座標が要ります'))).toBe(false)
  })

  it('通信断・タイムアウト・5xx では落ちる（沈黙させない・260824_flood §6.3）', () => {
    expect(shouldFallBackOffline(new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldFallBackOffline(new DOMException('Aborted', 'AbortError'))).toBe(true)
    expect(shouldFallBackOffline(new HttpError(500, 'x'))).toBe(true)
  })
})
