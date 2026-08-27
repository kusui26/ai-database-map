/**
 * GET /api/hazard/escape?lon=&lat=&for=&placeJa=
 * — **どちらへ動けば区域の外か**（§8.6）。
 *
 * 中身は `lib/hazard/escape-source` が持つ。**AI ツール `findEscapeDirection` も同じ関数を通る**。
 *
 * ⚠ **経路案内ではない。** 返すのは方向と直線距離だけで、道路の冠水は見ていない。
 * 応答の `limitationsJa` を必ずそのまま表示すること。
 */

import { hazardEscapeQuerySchema } from '@/shared/api'
import { escapeDirectionAt } from '@/lib/hazard/escape-source'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url)
    const params = url.searchParams
    const query = hazardEscapeQuerySchema.parse({
      lon: params.get('lon'),
      lat: params.get('lat'),
      for: params.get('for'),
      placeJa: params.get('placeJa') ?? undefined,
    })
    const escape = await escapeDirectionAt(
      { lon: query.lon, lat: query.lat, placeJa: query.placeJa, disaster: query.for },
      url.origin,
    )
    // 元は静的な想定区域なので、地点のハザードと同じく 1 日配ってよい。
    return json(escape, CACHE.day)
  })
}
