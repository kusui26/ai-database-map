import { isRankableKey } from '@/shared/catalog'
import { rankingQuerySchema } from '@/shared/api'
import { rankByColumn } from '@/db/queries'
import { buildRanking } from '@/domain/ranking/presenter'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/ranking?metric=&prefecture=&order=&limit= — 順位表（値＋整形＋フラグ）。 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = rankingQuerySchema.parse({
      metric: params.get('metric') ?? undefined,
      prefecture: params.get('prefecture') ?? undefined,
      order: params.get('order') ?? undefined,
      limit: params.get('limit') ?? undefined,
    })
    if (!isRankableKey(query.metric)) {
      throw new BadRequestError(`ランキング不可の metric です: ${query.metric}`)
    }
    const prefecture = query.prefecture ?? null
    const rows = await rankByColumn(query.metric, prefecture, query.order, query.limit)
    return json(buildRanking(query.metric, prefecture, query.order, rows), CACHE.hour)
  })
}
