import { stationClassesQuerySchema } from '@/shared/api'
import { loadStationClasses } from '@/domain/style/load'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/stations/classes?metric=&area=… — エリアの駅の色分け（2026-10-10 B5b・§6.12.6）。
 *
 * 指標（ランキングできる key）とエリア（`area` を 1〜4 回繰り返す・合わせて 1 つの凡例）→ 凡例（段・色・範囲・駅の数・⚠ と
 * 値なしの数・色の意味）と駅ごとの段。分け方は `src/domain/style/` の 1 か所——Web 地図・`render_map`・要約の凡例が同じ物を描く。
 * 駅が 5 未満・値が 1 種類だけのときは段を作らず、理由（`legend.reasonJa`）を返す。
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = stationClassesQuerySchema.parse({
      metric: params.get('metric') ?? undefined,
      areas: params.getAll('area'),
    })
    const result = await loadStationClasses(query.metric, query.areas)
    if (!result.ok) throw new BadRequestError(result.messageJa)
    return json(result.response, CACHE.hour)
  })
}
