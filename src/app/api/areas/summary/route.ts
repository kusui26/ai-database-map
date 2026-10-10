import { areaSummaryQuerySchema } from '@/shared/api'
import { isRadiusM } from '@/shared/constants'
import { loadAreaSummary } from '@/domain/area-summary/load'
import { BadRequestError, CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/areas/summary?area=…&area=…&radiusM=&colorBy= — エリアの要約（2026-10-10 B5b・§6.12.7）。
 *
 * エリア（`area` を 1〜4 回繰り返す・2 つ以上は比較）の区域の値（年ごとの値・増減・作り方・出典・推計の当たり具合）、
 * 出せない値と理由、駅の分布（`radiusM` の円・既定 1km）、内訳、比較、色分けの条件と凡例（`colorBy`・省略＝人口の増減 5 年・
 * `none`＝色分けしない）、注記。知らないエリア・幅の無い沿線・色分けできない指標は 400 で理由を返す（黙って全国にしない）。
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = areaSummaryQuerySchema.parse({
      areas: params.getAll('area'),
      radiusM: params.get('radiusM') ?? undefined,
      colorBy: params.get('colorBy') ?? undefined,
    })
    const radiusM = query.radiusM
    if (!isRadiusM(radiusM)) throw new BadRequestError(`集計半径が不正です: ${radiusM}`)
    const result = await loadAreaSummary({ areas: query.areas, radiusM, colorBy: query.colorBy })
    if (!result.ok) throw new BadRequestError(result.messageJa)
    return json(result.response, CACHE.hour)
  })
}
