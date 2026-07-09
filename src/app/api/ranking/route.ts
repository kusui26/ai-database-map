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
    const prefParam = params.get('prefecture')
    const query = rankingQuerySchema.parse({
      metric: params.get('metric') ?? undefined,
      prefectures: prefParam === null ? undefined : prefParam.split(',').filter(Boolean),
      order: params.get('order') ?? undefined,
      limit: params.get('limit') ?? undefined,
      offset: params.get('offset') ?? undefined,
      excludeLowN: params.get('excludeLowN') ?? undefined,
    })
    if (!isRankableKey(query.metric)) {
      throw new BadRequestError(`ランキング不可の metric です: ${query.metric}`)
    }
    const { rows, total } = await rankByColumn(
      query.metric,
      query.prefectures,
      query.order,
      query.limit,
      query.offset,
      query.excludeLowN,
    )
    return json(
      buildRanking(query.metric, query.prefectures, query.order, rows, total, query.offset),
      CACHE.hour,
    )
  })
}
