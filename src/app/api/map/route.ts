/**
 * GET /api/map?t=<署名トークン> — `render_map` が発行した短命 URL の実体（PR-13）。
 *
 * **何も保存しない**：t は署名済みの「地図操作（`MapAction[]`）」で、取得のたびに
 * 駅の座標を引き直し、キキクルの時刻を取り直して HTML を組む。開くたびに最新の面になり、
 * 描かれるものは常にツールの応答と一致する。
 *
 * 返すのは**自己完結の 1 ページ**（Leaflet 同梱・外部スクリプト無し）。母艦の `presentHtml` に
 * 保存して渡してもよいし、ブラウザで直接開いてもよい。
 */

import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/ai/rate-limit'
import { defaultTitleJa, reportNotesJa, resolveReportLayers, sceneFor } from '@/ai/map-report/build'
import { buildMapReportHtml, mapReportTileOrigins } from '@/ai/map-report/html'
import { LEAFLET_CSS, LEAFLET_JS, LEAFLET_VERSION } from '@/ai/map-report/assets'
import { verifyMapToken } from '@/ai/map-report/token'
import { signedUrlSecret } from '@/ai/signed-url'
import { jstDateTimeJa } from '@/shared/time'
import { apiError, clientIp, handle } from '@/lib/http'

export const runtime = 'nodejs'
/** 駅の座標（DB）とキキクルの時刻（気象庁）を取るので、MCP ルートと同じ枠を持たせる。 */
export const maxDuration = 60

/** 生成レート（IP・1 分・固定窓）。上流（気象庁）を叩くので通常 API より絞る。 */
const MAP_LIMIT_PER_MINUTE = 10
const WINDOW_MS = 60_000

/**
 * この 1 ページに許す接続先。**タイルの画像だけ**——`connect-src 'none'` なので
 * fetch も XHR も通らず、`sandbox allow-scripts` で自オリジンからも切り離す
 * （直接開かれても当アプリのオリジンには触れない）。
 */
function cspFor(tileOrigins: readonly string[]): string {
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src ${tileOrigins.join(' ')}`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const limited = checkRateLimit(`map:${clientIp(request)}`, {
      limit: MAP_LIMIT_PER_MINUTE,
      windowMs: WINDOW_MS,
      now: Date.now(),
    })
    if (!limited.ok) {
      const retryAfterSec = Math.ceil(limited.retryAfterMs / 1000)
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `リクエストが多すぎます。約 ${retryAfterSec} 秒待って再試行してください。`,
          },
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' },
        },
      )
    }

    const token = new URL(request.url).searchParams.get('t')
    if (token === null || token.length === 0) {
      return apiError(
        'BAD_REQUEST',
        't（署名トークン）が必要です。URL は render_map ツールが発行します。',
        400,
      )
    }
    const verified = verifyMapToken(token, { secret: signedUrlSecret(), now: Date.now() })
    if (!verified.ok) {
      if (verified.reason === 'expired') {
        return apiError(
          'MAP_EXPIRED',
          'URL の有効期限（約 24 時間）が切れています。render_map を呼び直して新しい URL を取得してください。',
          410,
        )
      }
      return apiError(
        'BAD_TOKEN',
        'URL が不正です。render_map が返した url を改変せずに使ってください。',
        400,
      )
    }

    const scene = await sceneFor(verified.query.actions)
    const { layers, dropped } = await resolveReportLayers(scene)
    const notesJa = [
      ...(scene.drawable
        ? []
        : ['この地図に描けるものがありませんでした（座標を持つ操作もレイヤも無いためです）。']),
      ...reportNotesJa({ scene, layers, dropped }),
    ]
    const html = buildMapReportHtml({
      title: verified.query.title ?? defaultTitleJa(scene),
      scene,
      layers,
      notesJa,
      generatedAtJa: jstDateTimeJa(Date.now()),
      assets: { js: LEAFLET_JS, css: LEAFLET_CSS, version: LEAFLET_VERSION },
    })
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': cspFor(mapReportTileOrigins(layers)),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
  })
}
