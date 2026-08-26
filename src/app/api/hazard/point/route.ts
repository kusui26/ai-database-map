/**
 * GET /api/hazard/point?lon=&lat=&placeJa= — **地点のハザード**（`docs/260824_flood.md` §6.1）。
 *
 * 3 つの情報源を**良いものから順に**当て、採ったものを `source` として必ず残す（§6.3）。
 * ①浸水ナビ（洪水・実測 m）→ ②公式タイルの画素（全ハザード・地図と同一）→ ③自前メッシュ（区間）。
 *
 * **意味づけ・総合判定は必ずここ（サーバ）で決める。** フロントに書いた瞬間、
 * AI が同じ判断をできなくなる（.claude/CLAUDE.md §2）。UI もチャットもこの応答を読むだけにする。
 *
 * **部分的に答えられるなら答える。** 外部が落ちていても、メッシュだけで組み立てて
 * `notesJa` に「何が取れなかったか」を書いて返す——防災系 UI では沈黙がいちばん困る。
 */

import { hazardPointQuerySchema } from '@/shared/api'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { pointHazard } from '@/domain/hazard/point'
import { meshReadings, tileReadings } from '@/lib/hazard/readings'
import { suibouNaviRivers } from '@/lib/hazard/suibou-navi'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** 呼び名の既定（UI から渡されなければ「この地点」）。 */
const DEFAULT_PLACE_JA = 'この地点'

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = hazardPointQuerySchema.parse({
      lon: params.get('lon'),
      lat: params.get('lat'),
      placeJa: params.get('placeJa') ?? undefined,
    })
    // 配布メッシュは CDN が配る静的アセット。関数バンドルに載せず、同じ origin から取る。
    const origin = new URL(request.url).origin
    const [mesh, tile, navi] = await Promise.all([
      meshReadings(query.lon, query.lat, origin),
      tileReadings(query.lon, query.lat),
      suibouNaviRivers(query.lon, query.lat, Date.now()),
    ])
    const notesJa = [mesh.noteJa, tile.noteJa, navi.noteJa].filter((note) => note !== null)
    const response = pointHazard(
      {
        lon: query.lon,
        lat: query.lat,
        placeJa: query.placeJa ?? DEFAULT_PLACE_JA,
        mesh: mesh.mesh,
        tile: tile.tile,
        rivers: navi.rivers,
        elevationM: mesh.elevationM,
        online: tile.reached,
        notesJa,
      },
      hazardLayersWithPointAnswer(),
    )
    // 完全な答えは年 1 回しか変わらないので 1 日。**欠けた答えは長く配らない**——
    // 外部が一瞬落ちただけで、河川情報の無いカードを 1 日配り続けることになる。
    return json(response, notesJa.length === 0 ? CACHE.day : CACHE.short)
  })
}
