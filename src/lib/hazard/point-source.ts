/**
 * 地点のハザードを組み立てる（**サーバ専用**・`docs/260824_flood.md` §6.1・§6.3）。
 *
 * `GET /api/hazard/point` と **AI ツール `getHazardAtPoint` の両方がここを通る**。
 * ツール側から HTTP を挟まないのは既存ツールと同じ流儀（`ai/tools.ts` の冒頭）で、
 * **人間UIと AI がまったく同じ関数を通る**ことを型で保証するためでもある。
 *
 * 3 つの情報源を良いものから順に当て、採ったものは `source` として応答に残す。
 * 外部が落ちていても**メッシュだけで組み立てて `notesJa` に理由を書いて返す**——
 * 防災系 UI では沈黙がいちばん困る。
 */

import type { HazardPointResponse } from '@/shared/api'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { pointHazard } from '@/domain/hazard/point'
import { meshReadings, tileReadings } from './readings'
import { suibouNaviRivers } from './suibou-navi'

/** 呼び名の既定（UI から渡されなければ「この地点」）。 */
export const DEFAULT_PLACE_JA = 'この地点'

export type HazardPointRequest = {
  readonly lon: number
  readonly lat: number
  readonly placeJa?: string
  /**
   * 配布メッシュを取りに行く起点。CDN が配る静的アセットなので、
   * 関数バンドルに載せず**同じ origin から**取る。
   */
  readonly baseUrl: string
  /** レート制限の窓に使う現在時刻（テストで固定できるように引数で受ける）。 */
  readonly now: number
}

/** 完全な答えかどうか。**欠けた応答は長くキャッシュしない**ための判断材料。 */
export type HazardPointResult = {
  readonly point: HazardPointResponse
  readonly complete: boolean
}

/** 地点のハザードを 1 つの意味づけ済みの形にまとめる。 */
export async function hazardPointAt(request: HazardPointRequest): Promise<HazardPointResult> {
  const { lon, lat, baseUrl, now } = request
  const [mesh, tile, navi] = await Promise.all([
    meshReadings(lon, lat, baseUrl),
    tileReadings(lon, lat),
    suibouNaviRivers(lon, lat, now),
  ])
  const notesJa = [mesh.noteJa, tile.noteJa, navi.noteJa].filter((note) => note !== null)
  const point = pointHazard(
    {
      lon,
      lat,
      placeJa: request.placeJa ?? DEFAULT_PLACE_JA,
      mesh: mesh.mesh,
      tile: tile.tile,
      tileNearby: tile.nearby,
      uncoveredLayerKeys: tile.uncoveredLayerKeys,
      rivers: navi.rivers,
      elevationM: mesh.elevationM,
      online: tile.reached,
      notesJa,
    },
    hazardLayersWithPointAnswer(),
  )
  return { point, complete: notesJa.length === 0 }
}
