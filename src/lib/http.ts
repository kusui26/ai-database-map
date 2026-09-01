/**
 * Route Handler 共通のレスポンス整形・エラー封筒（plan_fable §3.3）。
 * すべての API は成功時 Cache-Control 付き JSON、失敗時 { error: { code, message } }。
 */

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { DbError } from '@/db/client'

/** キャッシュポリシー（CDN が吸収）。 */
export const CACHE: Readonly<Record<'day' | 'hour' | 'short' | 'none', string>> = {
  day: 'public, s-maxage=86400, stale-while-revalidate=3600',
  hour: 'public, s-maxage=3600, stale-while-revalidate=600',
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
