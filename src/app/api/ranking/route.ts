import { isRankableKey } from '@/shared/catalog'
import { rankingQuerySchema } from '@/shared/api'
import { rankByColumn } from '@/db/queries'
import { resolveLineCodes } from '@/domain/lines'
import { labelsOfOperators } from '@/domain/operators'
import { buildRanking } from '@/domain/ranking/presenter'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** カンマ区切りのクエリを配列に（未指定は undefined＝スキーマ既定）。 */
function listParam(value: string | null): string[] | undefined {
  return value === null ? undefined : value.split(',').filter(Boolean)
}

/**
 * GET /api/ranking?metric=&prefecture=&operators=&routes=&routeTypes=&lines=&order=&limit= — 順位表。
 * lines は路線（運行系統）の路線コード（GET /api/lines の lineCd・261008 L2）。題にも路線の名前が入る。
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const typesParam = listParam(params.get('routeTypes'))
    const query = rankingQuerySchema.parse({
      metric: params.get('metric') ?? undefined,
      prefectures: listParam(params.get('prefecture')),
      operators: listParam(params.get('operators')),
      routes: listParam(params.get('routes')),
      routeTypes: typesParam?.map(Number).filter((type) => Number.isInteger(type)),
      lines: listParam(params.get('lines'))?.map(Number),
      order: params.get('order') ?? undefined,
      limit: params.get('limit') ?? undefined,
      offset: params.get('offset') ?? undefined,
      excludeLowN: params.get('excludeLowN') ?? undefined,
    })
    if (!isRankableKey(query.metric)) {
      throw new BadRequestError(`ランキング不可の metric です: ${query.metric}`)
    }
    const [lines, operatorLabels] = await Promise.all([
      resolveLineCodes(query.lines),
      labelsOfOperators(query.operators),
    ])
    if (!lines.ok) throw new BadRequestError(lines.messageJa)
    const { rows, total } = await rankByColumn(
      query.metric,
      query.prefectures,
      query.order,
      query.limit,
      query.offset,
      query.excludeLowN,
      query.operators,
      query.routes,
      query.routeTypes,
      lines.lines.map((line) => line.lineCd),
    )
    return json(
      buildRanking(query.metric, query.prefectures, query.order, rows, total, query.offset, {
        operators: query.operators,
        operatorLabels,
        routes: query.routes,
        routeTypes: query.routeTypes,
        lines: lines.lines,
      }),
      CACHE.hour,
    )
  })
}
