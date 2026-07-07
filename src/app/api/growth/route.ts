import { isRankableKey, requireEntry } from '@/shared/catalog'
import { growthQuerySchema } from '@/shared/api'
import { valuesForColumns } from '@/db/queries'
import { buildGrowth } from '@/domain/growth/presenter'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/growth?x=&y=&prefecture=&excludeLowN= — 散布点＋クラスタ。 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = growthQuerySchema.parse({
      x: params.get('x') ?? undefined,
      y: params.get('y') ?? undefined,
      prefecture: params.get('prefecture') ?? undefined,
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

    const prefecture = query.prefecture ?? null
    const rows = await valuesForColumns(keys, prefecture)
    return json(
      buildGrowth(rows, query.x, query.y, { excludeLowN: query.excludeLowN, prefecture }),
      CACHE.hour,
    )
  })
}
