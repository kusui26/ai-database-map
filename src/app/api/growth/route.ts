import { isRankableKey, requireEntry } from '@/shared/catalog'
import { growthQuerySchema } from '@/shared/api'
import { valuesForColumns } from '@/db/queries'
import { buildGrowth } from '@/domain/growth/presenter'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/growth?x=&y=&prefecture=&operators=&excludeLowN= — 散布点＋クラスタ。 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const prefParam = params.get('prefecture')
    const opsParam = params.get('operators')
    const query = growthQuerySchema.parse({
      x: params.get('x') ?? undefined,
      y: params.get('y') ?? undefined,
      prefectures: prefParam === null ? undefined : prefParam.split(',').filter(Boolean),
      operators: opsParam === null ? undefined : opsParam.split(',').filter(Boolean),
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

    const rows = await valuesForColumns(keys, query.prefectures, query.operators)
    return json(
      buildGrowth(rows, query.x, query.y, {
        excludeLowN: query.excludeLowN,
        prefectures: query.prefectures,
        operators: query.operators,
      }),
      CACHE.hour,
    )
  })
}
