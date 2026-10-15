/**
 * 地図の見えている範囲の広さと、中心に最も近い点（純関数・2026-10-09 B3 → 2026-10-15 B5e で切り出し）。
 *
 * チャットの「このあたり」（`ai/area/map-view.ts`）と、エリアの図を開いた直後のエリア（`domain/area-summary/locate.ts`）が
 * 同じ規則で決める——「このあたり」と言える広さ、「この区」「この市」を中心の駅の市区町村と読める寄り方。
 * 規則を 2 か所に持つと、同じ地図を見ているのにチャットと図で「ここ」の広さが食い違う。
 */

import { type LonLat } from '@/shared/geo'
import { type Viewport } from '@/shared/viewport'

/**
 * 「このあたり」として扱える広さの上限（経度・緯度の幅・度）。首都圏の初期表示（約 2°×0.9°）や、
 * 関東から東海までを見渡す広さ（約 7°）は使える。九州全体（約 14°）・日本全体（約 30°）は使えない。
 */
export const MAP_VIEW_MAX_LON_SPAN_DEG = 8
export const MAP_VIEW_MAX_LAT_SPAN_DEG = 6
/**
 * 「この区」「この市」を中心の駅の市区町村と読める広さの上限（km・縦横の長い方）。区や市が画面の主役になる寄り方
 * （ズーム 11 前後）まで。首都圏の初期表示（約 180km）で「この市」を千代田区と読まない。
 */
export const MAP_WARD_MAX_SPAN_KM = 50

const EARTH_RADIUS_M = 6_371_000
const M_PER_KM = 1000

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
export function distanceM(a: LonLat, b: LonLat): number {
  const x = radians(b.lon - a.lon) * Math.cos(radians((a.lat + b.lat) / 2))
  const y = radians(b.lat - a.lat)
  return Math.hypot(x, y) * EARTH_RADIUS_M
}

/** 範囲の真ん中。 */
export function viewCenter(viewport: Viewport): LonLat {
  return { lon: (viewport.west + viewport.east) / 2, lat: (viewport.south + viewport.north) / 2 }
}

/** 範囲の幅と高さ（km・中心を通る線で測る）。 */
export function viewSpanKm(viewport: Viewport): {
  readonly widthKm: number
  readonly heightKm: number
} {
  const center = viewCenter(viewport)
  const west = { lon: viewport.west, lat: center.lat }
  const east = { lon: viewport.east, lat: center.lat }
  const south = { lon: center.lon, lat: viewport.south }
  const north = { lon: center.lon, lat: viewport.north }
  return { widthKm: distanceM(west, east) / M_PER_KM, heightKm: distanceM(south, north) / M_PER_KM }
}

/** 「この区」「この市」を中心の駅の市区町村と読めるほど寄っているか。 */
export function isWardScale(viewport: Viewport): boolean {
  const { widthKm, heightKm } = viewSpanKm(viewport)
  return Math.max(widthKm, heightKm) <= MAP_WARD_MAX_SPAN_KM
}

/** 点に最も近いもの（無ければ null）。同じ距離なら先に並んでいるほう。 */
export function nearestTo<T extends LonLat>(
  point: LonLat,
  items: Iterable<T>,
): { readonly item: T; readonly distanceM: number } | null {
  return [...items].reduce<{ readonly item: T; readonly distanceM: number } | null>(
    (closest, item) => {
      const d = distanceM(point, item)
      return closest === null || d < closest.distanceM ? { item, distanceM: d } : closest
    },
    null,
  )
}
