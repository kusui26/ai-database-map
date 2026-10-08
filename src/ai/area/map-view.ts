/**
 * 地図の表示範囲を、LLM に伝える形にする（純関数・2026-10-09 B3・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * 「このあたりで地価が上がっている駅は？」の「このあたり」は、送信時に地図に表示している範囲（L3 で同送・
 * 外向きに丸めた bbox）。LLM には**範囲の広さと、中心に近い駅（その市区町村）**だけを見せる——経度・緯度の数は
 * 見せない。範囲で絞るのはツールの `inMapView` で、範囲はサーバが持っている（4 つの数を書き写させると、
 * 写し違いで黙って別の駅の集合になる）。
 *
 * 日本全体に近いほど広いと「このあたり」がどこか決まらないので、使わずに聞き返させる（サーバも断る）。
 */

import { type CatalogStation } from '@/db/queries'
import { type Viewport } from '@/shared/viewport'
import { type AreaIndex, type LonLat } from './place-index'

/**
 * 「このあたり」として扱える広さの上限（経度・緯度の幅・度）。首都圏の初期表示（約 2°×0.9°）や、
 * 関東から東海までを見渡す広さ（約 7°）は使える。九州全体（約 14°）・日本全体（約 30°）は使えない。
 */
export const MAP_VIEW_MAX_LON_SPAN_DEG = 8
export const MAP_VIEW_MAX_LAT_SPAN_DEG = 6
/** 中心に近い駅として挙げる距離の上限（m）。中心が海・山の上なら挙げない（「この区」を遠い駅で答えない）。 */
export const MAP_CENTER_STATION_MAX_M = 5000
/**
 * 「この区」「この市」を中心の駅の市区町村と読める広さの上限（km・縦横の長い方）。区や市が画面の主役になる寄り方
 * （ズーム 11 前後）まで。首都圏の初期表示（約 180km）で「この市」を千代田区と読まない。
 */
export const MAP_WARD_MAX_SPAN_KM = 50

const EARTH_RADIUS_M = 6_371_000
const M_PER_KM = 1000

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

/** 「このあたり」として扱えないほど広いか。 */
export function isTooWideForArea(viewport: Viewport): boolean {
  return (
    viewport.east - viewport.west > MAP_VIEW_MAX_LON_SPAN_DEG ||
    viewport.north - viewport.south > MAP_VIEW_MAX_LAT_SPAN_DEG
  )
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** 2 点の距離（m・正距円筒の近似。地図の広さと最寄りの駅を選ぶには十分）。 */
function distanceM(a: LonLat, b: LonLat): number {
  const x = radians(b.lon - a.lon) * Math.cos(radians((a.lat + b.lat) / 2))
  const y = radians(b.lat - a.lat)
  return Math.hypot(x, y) * EARTH_RADIUS_M
}

function centerOf(viewport: Viewport): LonLat {
  return { lon: (viewport.west + viewport.east) / 2, lat: (viewport.south + viewport.north) / 2 }
}

/** 中心に最も近い駅（近くに無ければ null）。 */
function nearestStation(point: LonLat, index: AreaIndex): MapCenterStation | null {
  const best = [...index.stationsByGrp.values()].reduce<{
    readonly station: CatalogStation
    readonly distanceM: number
  } | null>((closest, station) => {
    const d = distanceM(point, station)
    return closest === null || d < closest.distanceM ? { station, distanceM: d } : closest
  }, null)
  if (best === null || best.distanceM > MAP_CENTER_STATION_MAX_M) return null
  const { station } = best
  return {
    name: station.name,
    prefecture: station.prefecture,
    municipality: station.municipality,
    distanceM: Math.round(best.distanceM),
  }
}

/** 地図の範囲 → LLM に伝える様子（索引が無ければ中心の駅は挙げない）。 */
export function describeMapView(viewport: Viewport, index: AreaIndex | null): MapView {
  const center = centerOf(viewport)
  const widthKm =
    distanceM({ lon: viewport.west, lat: center.lat }, { lon: viewport.east, lat: center.lat }) /
    M_PER_KM
  const heightKm =
    distanceM({ lon: center.lon, lat: viewport.south }, { lon: center.lon, lat: viewport.north }) /
    M_PER_KM
  const tooWide = isTooWideForArea(viewport)
  const centerSearched = !tooWide && index !== null
  const nearest = centerSearched ? nearestStation(center, index) : null
  const wardScale = Math.max(widthKm, heightKm) <= MAP_WARD_MAX_SPAN_KM
  return { widthKm, heightKm, tooWide, center: nearest, centerSearched, wardScale }
}
