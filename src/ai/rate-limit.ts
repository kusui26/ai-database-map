/**
 * 簡易 IP レート制限（Step2・チャット濫用/コスト対策・plan_fable §7）。
 *
 * 依存を増やさずに固定窓カウンタで実装する（`now` を注入して純粋にテスト可能）。
 * ⚠ サーバレスではインスタンスごとのメモリ＝厳密な全体制限ではない。P8a の下限として十分で、
 * 本番強化は Upstash Redis 等へ差し替える（seam はこのモジュール）。
 */

/** 既定：60 秒あたり 20 リクエスト / IP。 */
export const RATE_LIMIT = 20
export const RATE_WINDOW_MS = 60_000

type Bucket = { count: number; resetAt: number }

const store = new Map<string, Bucket>()

export type RateLimitOptions = {
  readonly limit: number
  readonly windowMs: number
  readonly now: number
}

export type RateLimitResult = {
  readonly ok: boolean
  readonly remaining: number
  readonly retryAfterMs: number
}

/** store がこの件数を超えたら期限切れエントリを一掃する（インメモリの無制限増加を防ぐ）。 */
const SWEEP_THRESHOLD = 10_000

function sweepExpired(now: number): void {
  for (const [key, bucket] of store) {
    if (now >= bucket.resetAt) store.delete(key)
  }
}

/** 固定窓でのレート判定（純粋・`now` 注入）。窓を跨いだらリセット。 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { limit, windowMs, now } = options
  if (store.size > SWEEP_THRESHOLD) sweepExpired(now) // 期限切れの掃除（メモリリーク防止）
  const bucket = store.get(key)
  if (bucket === undefined || now >= bucket.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 }
  }
  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: bucket.resetAt - now }
  }
  bucket.count += 1
  return { ok: true, remaining: limit - bucket.count, retryAfterMs: 0 }
}

/** テスト用：内部状態をクリアする。 */
export function resetRateLimitStore(): void {
  store.clear()
}

/** 既定設定での判定（ルートから呼ぶ薄いラッパ）。 */
export function rateLimit(key: string, now: number): RateLimitResult {
  return checkRateLimit(key, { limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS, now })
}
