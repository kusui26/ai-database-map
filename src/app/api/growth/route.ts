import { isRankableKey, requireEntry } from '@/shared/catalog'
import { growthQuerySchema } from '@/shared/api'
import { scatterPoints } from '@/db/queries'
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

    // 信頼性フラグは除外するときだけ引く（引かなければ DB 側の集計も軽い）。
    const flags = query.excludeLowN
      ? [requireEntry(query.x).reliabilityFlagKey, requireEntry(query.y).reliabilityFlagKey]
      : [null, null]

    const rows = await scatterPoints(query.x, query.y, flags[0] ?? null, flags[1] ?? null, {
      prefectures: query.prefectures,
      operators: query.operators,
      routes: query.routes,
      routeTypes: query.routeTypes,
    })
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
