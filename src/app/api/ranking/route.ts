import { isRankableKey } from '@/shared/catalog'
import { rankingQuerySchema } from '@/shared/api'
import { rankByColumn } from '@/db/queries'
import { resolveFilters } from '@/domain/filters'
import { buildRanking } from '@/domain/ranking/presenter'
import { filterParams } from '@/lib/filter-params'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/ranking?metric=&prefecture=&municipality=&bbox=&nearStation=&withinM=&operators=&routes=&routeTypes=&lines=
 *   &order=&limit= — 順位表。
 * lines は路線（運行系統）の路線コード（GET /api/lines の lineCd・261008 L2）。municipality は市区町村の前方一致、
 * bbox は「西,南,東,北」、nearStation（起点の駅の grp）と withinM（m）は組で「起点から N m 以内」（261008 B2）。
 * 近傍のときは行に起点からの距離（distM）が付く。題にも路線・場所の名前が入る。
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = rankingQuerySchema.parse({
      metric: params.get('metric') ?? undefined,
      ...filterParams(params),
      order: params.get('order') ?? undefined,
      limit: params.get('limit') ?? undefined,
      offset: params.get('offset') ?? undefined,
      excludeLowN: params.get('excludeLowN') ?? undefined,
    })
    if (!isRankableKey(query.metric)) {
      throw new BadRequestError(`ランキング不可の metric です: ${query.metric}`)
    }
    const resolved = await resolveFilters(query)
    if (!resolved.ok) throw new BadRequestError(resolved.messageJa)
    const { filter, lines, operatorLabels, area } = resolved.filters
    const { rows, total } = await rankByColumn(query.metric, filter, {
      order: query.order,
      limit: query.limit,
      offset: query.offset,
      excludeLowN: query.excludeLowN,
    })
    return json(
      buildRanking(query.metric, query.prefectures, query.order, rows, total, query.offset, {
        operators: query.operators,
        operatorLabels,
        routes: query.routes,
        routeTypes: query.routeTypes,
        lines,
        area,
      }),
      CACHE.hour,
    )
  })
}
