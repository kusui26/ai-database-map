/**
 * 地図の表示範囲（2026-10-08 L3・`docs/261001_fix_user_feedback_ui.md` §6.8.6）。
 *
 * チャットの送信に同送し、AI が同じ名前の路線（「山手線」＝JR・神戸市営地下鉄、「中央線」＝JR・大阪メトロ）を
 * 決めるのに使う——首都圏を見ている人の「中央線」は JR中央線(快速)、大阪を見ている人のは大阪メトロ中央線。
 * 2026-10-09 B3 からは「このあたり」の質問にも使う（ツールの inMapView・`src/ai/area/map-view.ts`）。
 * 地図（MapView）が止まるたびに、パネルに隠れていない部分の範囲（`components/map/visibleBounds.ts`）を丸めて持ち
 * （`mapStore`）、送るときにサーバへ渡す（`/api/chat`）。
 *
 * **外向きに丸める**（西・南は切り捨て、東・北は切り上げ）：見えている範囲を必ず含む。生の値を送らないのは、
 * 1px 動かすたびに値が変わらないようにするため（中心の丸めと同じ粗さ・約 1km）。
 *
 * 初期バンドル（地図）から読まれるので zod は持ち込まない（検証は `isValidViewport` で足りる）。
 */

/** 経度・緯度（度）の範囲。 */
export type Viewport = {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

/** 送る形（`[west, south, east, north]`・ツールの `bbox` と同じ並び）。 */
export type ViewportTuple = readonly [number, number, number, number]

/** 丸めの桁（小数 2 桁 ≒ 1.1km・地図の中心の丸めと同じ）。 */
export const VIEWPORT_DECIMALS = 2

const MAX_LON_DEG = 180
const MAX_LAT_DEG = 90

function clamp(value: number, limit: number): number {
  return Math.min(Math.max(value, -limit), limit)
}

/** 桁で切り捨て・切り上げ（浮動小数の端数を残さない）。 */
function roundTo(value: number, direction: 'down' | 'up'): number {
  const scale = 10 ** VIEWPORT_DECIMALS
  const scaled = direction === 'down' ? Math.floor(value * scale) : Math.ceil(value * scale)
  return Number((scaled / scale).toFixed(VIEWPORT_DECIMALS))
}

/**
 * 外向きに丸め、経度・緯度の範囲に収める。地図を引いて世界の複製が見えるとき（経度が ±180 を超える）も、
 * 範囲の端で止める。
 */
export function roundViewport(bounds: Viewport): Viewport {
  return {
    west: clamp(roundTo(bounds.west, 'down'), MAX_LON_DEG),
    south: clamp(roundTo(bounds.south, 'down'), MAX_LAT_DEG),
    east: clamp(roundTo(bounds.east, 'up'), MAX_LON_DEG),
    north: clamp(roundTo(bounds.north, 'up'), MAX_LAT_DEG),
  }
}

/** 経度・緯度として使えるか（有限・経度は ±180・緯度は ±90 の内）。 */
export function isValidLonLat(lon: number, lat: number): boolean {
  const finite = Number.isFinite(lon) && Number.isFinite(lat)
  return finite && Math.abs(lon) <= MAX_LON_DEG && Math.abs(lat) <= MAX_LAT_DEG
}

/** 範囲として使えるか（有限・西 < 東・南 < 北・経度緯度の範囲内）。 */
export function isValidViewport(viewport: Viewport): boolean {
  const { west, south, east, north } = viewport
  return isValidLonLat(west, south) && isValidLonLat(east, north) && west < east && south < north
}

export function viewportToTuple(viewport: Viewport): ViewportTuple {
  return [viewport.west, viewport.south, viewport.east, viewport.north]
}

/** 4 値 → 範囲（使えなければ null＝範囲なしとして扱う）。 */
export function viewportFromTuple(values: readonly number[]): Viewport | null {
  const [west, south, east, north] = values
  if (values.length !== 4 || west === undefined || south === undefined) return null
  if (east === undefined || north === undefined) return null
  const viewport = { west, south, east, north }
  return isValidViewport(viewport) ? viewport : null
}

/** 同じ範囲か（丸めたあとの値で比べる）。 */
export function sameViewport(a: Viewport | null, b: Viewport | null): boolean {
  if (a === null || b === null) return a === b
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north
}
