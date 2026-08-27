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
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
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
