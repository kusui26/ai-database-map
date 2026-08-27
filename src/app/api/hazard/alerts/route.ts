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
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
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
