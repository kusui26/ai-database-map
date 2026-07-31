import { isRankableKey, requireEntry } from '@/shared/catalog'
import { growthQuerySchema } from '@/shared/api'
import { valuesForColumns } from '@/db/queries'
import { buildGrowth } from '@/domain/growth/presenter'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** カンマ区切りのクエリを配列に（未指定は undefined＝スキーマ既定）。 */
function listParam(value: string | null): string[] | undefined {
  return value === null ? undefined : value.split(',').filter(Boolean)
}

/** GET /api/growth?x=&y=&prefecture=&operators=&routes=&routeTypes=&excludeLowN= — 散布点＋クラスタ。 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const typesParam = listParam(params.get('routeTypes'))
    const query = growthQuerySchema.parse({
      x: params.get('x') ?? undefined,
      y: params.get('y') ?? undefined,
      prefectures: listParam(params.get('prefecture')),
      operators: listParam(params.get('operators')),
      routes: listParam(params.get('routes')),
      routeTypes: typesParam?.map(Number).filter((type) => Number.isInteger(type)),
      excludeLowN: params.get('excludeLowN') ?? undefined,
    })
    for (const key of [query.x, query.y]) {
      if (!isRankableKey(key)) throw new BadRequestError(`散布不可の metric です: ${key}`)
    }

    const keys = [query.x, query.y]
    if (query.excludeLowN) {
      for (const entry of [requireEntry(query.x), requireEntry(query.y)]) {
        if (entry.reliabilityFlagKey !== null) keys.push(entry.reliabilityFlagKey)
      }
    }

    const rows = await valuesForColumns(
      keys,
      query.prefectures,
      query.operators,
      query.routes,
      query.routeTypes,
    )
    return json(
      buildGrowth(rows, query.x, query.y, {
        excludeLowN: query.excludeLowN,
        prefectures: query.prefectures,
        operators: query.operators,
        routes: query.routes,
        routeTypes: query.routeTypes,
      }),
      CACHE.hour,
    )
  })
}
