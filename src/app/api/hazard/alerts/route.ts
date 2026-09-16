/**
 * GET /api/hazard/alerts?lon=&lat=&placeJa= — **いま、その地点に何が出ているか**（§3.3(d)・§8.4）。
 *
 * 中身は `lib/hazard/alert-source` が持つ。**AI ツール `getHazardAlerts` も同じ関数を通る**。
 *
 * 平時の「もし起きたら」（`/api/hazard/point`）とは**別のエンドポイント**にしてある。
 * 混ぜると「今は安全」と読まれかねないし、キャッシュの寿命もまったく違う（1 日 対 30 秒）。
 */

import { hazardAlertQuerySchema } from '@/shared/api'
import { hazardAlertsAt } from '@/lib/hazard/alert-source'
import { limitPerMinute } from '@/ai/rate-limit'
import { CACHE, clientIp, handle, json, rateLimited } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * 1 分あたりの上限（IP・固定窓・`docs/260916_ops_guard.md` G5）。
 *
 * **守っているのは自分のサーバではなく気象庁**。CDN は効くが、
 * **座標が 1 つ違えば別のキャッシュキー**なので、地図の上を機械的になぞられるとそのまま
 * 上流への取得になる。同じ上流を叩く MCP ツール `get_hazard_alerts` は 10/分。
 * 画面は 1 つの問いで複数のルートを呼ぶ（地点 → いまの警報 → 避難先）ので、その 2 倍を置く。
 *
 * ⚠ **総量の蓋ではない。** IP ごと・インスタンスごとなので、分散した相手には効かない。
 * 閉じるのは「1 本のスクリプトがうっかり回す」場合である。
 */
const PER_MINUTE = 20

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const limited = limitPerMinute(`hazard-alerts:${clientIp(request)}`, PER_MINUTE)
    if (!limited.ok) return rateLimited(limited.retryAfterMs)
    const params = new URL(request.url).searchParams
    const query = hazardAlertQuerySchema.parse({
      lon: params.get('lon'),
      lat: params.get('lat'),
      placeJa: params.get('placeJa') ?? undefined,
    })
    const alerts = await hazardAlertsAt({ ...query, now: Date.now() })
    // 気象庁の配信が `max-age=60`。**古い情報を「今」と言わない**ため、長く配らない。
    return json(alerts, CACHE.short)
  })
}
