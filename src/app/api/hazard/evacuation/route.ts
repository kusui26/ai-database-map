/**
 * GET /api/hazard/evacuation?lon=&lat=&for=&placeJa=&radiusM=&top=
 * — **どこに逃げるか**（§3.5・§8.5）。
 *
 * 中身は `lib/hazard/evacuation-source` が持つ。**AI ツール `findEvacuationSites` も同じ関数を通る**。
 *
 * `for`（災害種別）は**必須**。既定で洪水に倒すと、土砂災害を心配している人に
 * 洪水にしか対応していない避難場所を返しうる（§11 リスク 10 ＝人命）。
 */

import { hazardEvacuationQuerySchema } from '@/shared/api'
import { evacuationSitesAt } from '@/lib/hazard/evacuation-source'
import { limitPerMinute } from '@/ai/rate-limit'
import { CACHE, clientIp, handle, json, rateLimited } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * 1 分あたりの上限（IP・固定窓・`docs/260916_ops_guard.md` G5）。
 *
 * **守っているのは自分のサーバではなく国土地理院のタイル**。CDN は効くが、
 * **座標が 1 つ違えば別のキャッシュキー**なので、地図の上を機械的になぞられるとそのまま
 * 上流への取得になる。同じ上流を叩く MCP ツール `find_evacuation_sites` は 10/分。
 * 画面は 1 つの問いで複数のルートを呼ぶ（地点 → いまの警報 → 避難先）ので、その 2 倍を置く。
 *
 * ⚠ **総量の蓋ではない。** IP ごと・インスタンスごとなので、分散した相手には効かない。
 * 閉じるのは「1 本のスクリプトがうっかり回す」場合である。
 */
const PER_MINUTE = 20

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const limited = limitPerMinute(`hazard-evacuation:${clientIp(request)}`, PER_MINUTE)
    if (!limited.ok) return rateLimited(limited.retryAfterMs)
    const url = new URL(request.url)
    const params = url.searchParams
    const query = hazardEvacuationQuerySchema.parse({
      lon: params.get('lon'),
      lat: params.get('lat'),
      for: params.get('for'),
      placeJa: params.get('placeJa') ?? undefined,
      radiusM: params.get('radiusM') ?? undefined,
      top: params.get('top') ?? undefined,
    })
    const sites = await evacuationSitesAt(
      {
        lon: query.lon,
        lat: query.lat,
        placeJa: query.placeJa,
        disaster: query.for,
        radiusM: query.radiusM,
        top: query.top,
      },
      url.origin,
    )
    // 指定の一覧は滅多に変わらないが、**開設状況ではない**ので日単位までは伸ばさない。
    return json(sites, CACHE.hour)
  })
}
