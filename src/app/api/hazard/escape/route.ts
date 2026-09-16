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
import { limitPerMinute } from '@/ai/rate-limit'
import { CACHE, clientIp, handle, json, rateLimited } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * 1 分あたりの上限（IP・固定窓・`docs/260916_ops_guard.md` G5）。
 *
 * **守っているのは自分のサーバではなく250m メッシュ**。CDN は効くが、
 * **座標が 1 つ違えば別のキャッシュキー**なので、地図の上を機械的になぞられるとそのまま
 * 上流への取得になる。同じ上流を叩く MCP ツール `find_escape_direction` は 10/分。
 * 画面は 1 つの問いで複数のルートを呼ぶ（地点 → いまの警報 → 避難先）ので、その 2 倍を置く。
 *
 * ⚠ **総量の蓋ではない。** IP ごと・インスタンスごとなので、分散した相手には効かない。
 * 閉じるのは「1 本のスクリプトがうっかり回す」場合である。
 */
const PER_MINUTE = 20

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const limited = limitPerMinute(`hazard-escape:${clientIp(request)}`, PER_MINUTE)
    if (!limited.ok) return rateLimited(limited.retryAfterMs)
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
