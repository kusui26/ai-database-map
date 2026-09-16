/**
 * Route Handler 共通のレスポンス整形・エラー封筒（plan_fable §3.3）。
 * すべての API は成功時 Cache-Control 付き JSON、失敗時 { error: { code, message } }。
 */

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { DbError } from '@/db/client'

/**
 * キャッシュポリシー（`s-maxage` は CDN 向け、`max-age` はブラウザ向け）。
 *
 * ## `max-age` が要る理由（`docs/260916_ops_guard.md` G1）
 *
 * Vercel の CDN は、下流へ返すときに **`s-maxage` と `stale-while-revalidate` を落とす**
 * （公式の挙動）。`max-age` は落とさない。つまり `s-maxage` だけ書いていると、
 * ブラウザに届く指示は `public` **だけ**になる。
 *
 * そこに `ETag` も `Last-Modified` も無い（実測）ので、ブラウザは鮮度を判断する材料を
 * 1 つも持たず、**毎回そのまま取り直す**。`/api/stations/geojson` は **227 KB（gzip）**あり、
 * 地図を開くたびにこれが流れていた。ここが最大の転送項目である。
 *
 * ## ブラウザの寿命は CDN より短くする
 *
 * **CDN はパージできるが、ブラウザのキャッシュは消せない。** データを差し替えたときに
 * 取り残される時間を短くするため、`max-age` は `s-maxage` の 1/12〜1/24 に置く。
 *
 * ## `short` には足さない
 *
 * ここには `/api/hazard/alerts`（いまの警報）と、外部が欠けたときの `/api/hazard/point` がいる。
 * **古い警報を「今」として見せない**ことのほうが転送量より重い（`docs/260824_flood.md` §7.4）。
 *
 * ⚠ 面ごとに指示を分けたくなったら、Vercel は `CDN-Cache-Control` /
 * `Vercel-CDN-Cache-Control` を受ける。いまは 1 本で足りるので使っていない。
 */
export const CACHE: Readonly<Record<'day' | 'hour' | 'short' | 'none', string>> = {
  day: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600',
  hour: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=600',
  short: 'public, s-maxage=30, stale-while-revalidate=60',
  none: 'no-store',
}

/** 400（入力不正・カタログ検証失敗）。 */
export class BadRequestError extends Error {}
/** 404（駅など未検出）。 */
export class NotFoundError extends Error {}

/** リクエスト元 IP。プラットフォームが設定する x-real-ip を優先（XFF 左端は詐称可能）。 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')
  if (realIp !== null && realIp.length > 0) return realIp
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() ?? 'unknown'
}

export function json<T>(data: T, cacheControl: string): NextResponse {
  return NextResponse.json(data, { headers: { 'Cache-Control': cacheControl } })
}

export function apiError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * 429（レート制限）。**`Retry-After` を必ず添える**——待つ秒数が分からないと、
 * 呼び出し側は総当たりで叩き直すしかない。
 */
export function rateLimited(retryAfterMs: number): NextResponse {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000)
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: `リクエストが多すぎます。約 ${retryAfterSec} 秒待って再試行してください。`,
      },
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' } },
  )
}

/** ハンドラを実行し、例外をエラー封筒（適切な status）へ変換する。 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ')
      return apiError('BAD_REQUEST', detail, 400)
    }
    if (error instanceof BadRequestError) return apiError('BAD_REQUEST', error.message, 400)
    if (error instanceof NotFoundError) return apiError('NOT_FOUND', error.message, 404)
    if (error instanceof DbError) return apiError('DB_ERROR', error.message, 502)
    const message = error instanceof Error ? error.message : 'unknown error'
    return apiError('INTERNAL', message, 500)
  }
}
