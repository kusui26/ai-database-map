import { areaDeps } from '@/ai/area/catalog'
import { locateArea, type LocateInput } from '@/domain/area-summary/locate'
import { areaLocateQuerySchema, type AreaLocateQuery } from '@/shared/api'
import { viewportFromTuple } from '@/shared/viewport'
import { BadRequestError, CACHE, handle, json, NotFoundError } from '@/lib/http'

export const runtime = 'nodejs'

/** 入力 → 手がかり（駅を先に見る・範囲の形が崩れていれば 400）。 */
function locateInputOf(query: AreaLocateQuery): LocateInput {
  if (query.grp !== undefined) return { kind: 'station', grp: query.grp }
  if (query.bbox === undefined) {
    throw new BadRequestError('grp（選択中の駅）か bbox（地図の範囲）が要ります')
  }
  const viewport = viewportFromTuple(query.bbox.split(',').map(Number))
  if (viewport === null) {
    throw new BadRequestError(
      `範囲は「西,南,東,北」の 4 つの数です（西＜東・南＜北）: ${query.bbox}`,
    )
  }
  return { kind: 'view', viewport }
}

/**
 * GET /api/areas/locate?grp= | bbox=西,南,東,北 — エリアの図を開いた直後のエリア（2026-10-15 B5e・
 * `docs/261001_fix_user_feedback_ui.md` §6.12.10）。選択中の駅ならその市区町村、無ければ地図の中心に近い駅で、寄り方に合わせて
 * 市区町村・都道府県・全国。決めた手がかり（`basisJa`）を添える。駅の座標と市区町村コードは全駅の索引（サーバで 1 時間持つ）から。
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = areaLocateQuerySchema.parse({
      grp: params.get('grp') ?? undefined,
      bbox: params.get('bbox') ?? undefined,
    })
    const input = locateInputOf(query)
    const index = await areaDeps().index()
    const result = locateArea(input, index.stationsByGrp)
    if (!result.ok) throw new NotFoundError(result.messageJa)
    return json(result.area, CACHE.hour)
  })
}
