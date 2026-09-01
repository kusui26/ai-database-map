import { type StationSummary, stationsQuerySchema } from '@/shared/api'
import { listStations, nearestStations, searchStations, stationsInBbox } from '@/db/queries'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

function parseNums(raw: string, count: number): number[] {
  const parts = raw.split(',').map(Number)
  if (parts.length !== count || parts.some((n) => Number.isNaN(n))) {
    throw new BadRequestError(`不正なパラメータ: ${raw}`)
  }
  return parts
}

/**
 * GET /api/stations?q= | bbox=w,s,e,n | near=lon,lat — 駅サマリ（≤50）。
 * GET /api/stations?municipality= | prefecture= [&limit=] — 駅一覧（対象集合・≤2000・260902）。
 * MCP の `list_stations` と同じ RPC を通る（AI と人間で別 API を作らない・CLAUDE.md §2）。
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = stationsQuerySchema.parse({
      q: params.get('q') ?? undefined,
      bbox: params.get('bbox') ?? undefined,
      near: params.get('near') ?? undefined,
      municipality: params.get('municipality') ?? undefined,
      prefecture: params.get('prefecture') ?? undefined,
      limit: params.get('limit') ?? undefined,
    })

    // 対象集合の一覧は件数が多い（横浜市 ≈ 150 駅）ので、50 件の頭切りをしない別枝。
    if (query.municipality !== undefined || query.prefecture !== undefined) {
      const stations = await listStations({
        prefectures: query.prefecture === undefined ? undefined : [query.prefecture],
        municipality: query.municipality,
        limit: query.limit,
      })
      return json(stations, CACHE.short)
    }

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
