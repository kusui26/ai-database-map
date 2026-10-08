import { isRankableKey, requireEntry } from '@/shared/catalog'
import { growthQuerySchema } from '@/shared/api'
import { scatterPoints } from '@/db/queries'
import { resolveFilters } from '@/domain/filters'
import { buildGrowth } from '@/domain/growth/presenter'
import { filterParams } from '@/lib/filter-params'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/growth?x=&y=&prefecture=&municipality=&bbox=&nearStation=&withinM=&operators=&routes=&routeTypes=&lines=
 *   &excludeLowN= — 散布点＋クラスタ。
 * 絞り込みはランキングと同じ（lines は路線コード・261008 L2、市区町村・範囲・近傍は 261008 B2）。題にも路線・場所の名前が入る。
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = growthQuerySchema.parse({
      x: params.get('x') ?? undefined,
      y: params.get('y') ?? undefined,
      ...filterParams(params),
      excludeLowN: params.get('excludeLowN') ?? undefined,
    })
    for (const key of [query.x, query.y]) {
      if (!isRankableKey(key)) throw new BadRequestError(`散布不可の metric です: ${key}`)
    }
    const resolved = await resolveFilters(query)
    if (!resolved.ok) throw new BadRequestError(resolved.messageJa)
    const { filter, lines, operatorLabels, area } = resolved.filters

    // 信頼性フラグは除外するときだけ引く（引かなければ DB 側の集計も軽い）。
    const flags = query.excludeLowN
      ? [requireEntry(query.x).reliabilityFlagKey, requireEntry(query.y).reliabilityFlagKey]
      : [null, null]

    const rows = await scatterPoints(query.x, query.y, flags[0] ?? null, flags[1] ?? null, filter)
    return json(
      buildGrowth(rows, query.x, query.y, {
        excludeLowN: query.excludeLowN,
        prefectures: query.prefectures,
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
