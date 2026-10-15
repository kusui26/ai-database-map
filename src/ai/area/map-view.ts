/**
 * 地図の表示範囲を、LLM に伝える形にする（純関数・2026-10-09 B3・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * 「このあたりで地価が上がっている駅は？」の「このあたり」は、送信時に地図に表示している範囲（L3 で同送・
 * 外向きに丸めた bbox）。LLM には**範囲の広さと、中心に近い駅（その市区町村）**だけを見せる——経度・緯度の数は
 * 見せない。範囲で絞るのはツールの `inMapView` で、範囲はサーバが持っている（4 つの数を書き写させると、
 * 写し違いで黙って別の駅の集合になる）。
 *
 * 日本全体に近いほど広いと「このあたり」がどこか決まらないので、使わずに聞き返させる（サーバも断る）。
 * 広さの規則（「このあたり」と言える広さ・「この区」と読める寄り方）は `domain/map/view-scale.ts`——エリアの図を
 * 開いた直後のエリア（B5e）も同じ規則で決める。
 */

import { type CatalogStation } from '@/db/queries'
import {
  isTooWideForArea,
  isWardScale,
  nearestTo,
  viewCenter,
  viewSpanKm,
} from '@/domain/map/view-scale'
import { type Viewport } from '@/shared/viewport'
import { type AreaIndex } from './place-index'

/** 中心に近い駅として挙げる距離の上限（m）。中心が海・山の上なら挙げない（「この区」を遠い駅で答えない）。 */
export const MAP_CENTER_STATION_MAX_M = 5000

/** 中心に近い駅（「この区」「この市」の手がかり）。 */
export type MapCenterStation = {
  /** 駅名（同じ名前の駅は、都道府県・市区町村で区別がつく）。 */
  readonly name: string
  readonly prefecture: string
  readonly municipality: string | null
  readonly distanceM: number
}

/** LLM に伝える地図の様子。 */
export type MapView = {
  readonly widthKm: number
  readonly heightKm: number
  /** 「このあたり」として扱えないほど広い（日本全体に近い）。 */
  readonly tooWide: boolean
  /** 中心に近い駅（広すぎるとき・近くに駅が無いとき・索引が無いときは null）。 */
  readonly center: MapCenterStation | null
  /** 中心の駅を調べたか（索引があり、広すぎない）。調べて無ければ「近くに駅は無い」と言え、調べていなければ何も言わない。 */
  readonly centerSearched: boolean
  /** 「この区」「この市」を中心の駅の市区町村と読めるほど寄っているか。 */
  readonly wardScale: boolean
}

/** 中心に最も近い駅（近くに無ければ null）。 */
function nearestStation(index: AreaIndex, viewport: Viewport): MapCenterStation | null {
  const best = nearestTo<CatalogStation>(viewCenter(viewport), index.stationsByGrp.values())
  if (best === null || best.distanceM > MAP_CENTER_STATION_MAX_M) return null
  const { item: station } = best
  return {
    name: station.name,
    prefecture: station.prefecture,
    municipality: station.municipality,
    distanceM: Math.round(best.distanceM),
  }
}

/** 地図の範囲 → LLM に伝える様子（索引が無ければ中心の駅は挙げない）。 */
export function describeMapView(viewport: Viewport, index: AreaIndex | null): MapView {
  const { widthKm, heightKm } = viewSpanKm(viewport)
  const tooWide = isTooWideForArea(viewport)
  const centerSearched = !tooWide && index !== null
  const center = centerSearched ? nearestStation(index, viewport) : null
  const wardScale = isWardScale(viewport)
  return { widthKm, heightKm, tooWide, center, centerSearched, wardScale }
}
