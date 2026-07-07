import { type StationSummary, stationsQuerySchema } from '@/shared/api'
import { nearestStations, searchStations, stationsInBbox } from '@/db/queries'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

function parseNums(raw: string, count: number): number[] {
  const parts = raw.split(',').map(Number)
  if (parts.length !== count || parts.some((n) => Number.isNaN(n))) {
    throw new BadRequestError(`不正なパラメータ: ${raw}`)
  }
  return parts
}

/** GET /api/stations?q= | bbox=w,s,e,n | near=lon,lat — 駅サマリ（≤50）。 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = stationsQuerySchema.parse({
      q: params.get('q') ?? undefined,
      bbox: params.get('bbox') ?? undefined,
      near: params.get('near') ?? undefined,
    })

    let results: StationSummary[]
    if (query.q !== undefined) {
      results = await searchStations(query.q)
    } else if (query.bbox !== undefined) {
      const [w, s, e, n] = parseNums(query.bbox, 4)
      results = await stationsInBbox(w ?? 0, s ?? 0, e ?? 0, n ?? 0)
    } else if (query.near !== undefined) {
      const [lon, lat] = parseNums(query.near, 2)
      results = await nearestStations(lon ?? 0, lat ?? 0)
    } else {
      throw new BadRequestError('q / bbox / near のいずれかが必要です')
    }

    return json(results.slice(0, 50), CACHE.short)
  })
}
