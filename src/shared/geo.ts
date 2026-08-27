/**
 * 空間ユーティリティ（純関数・依存なし）。
 * 半径サークルの GeoJSON 生成など。turf 等に依存せず自前で描く（.claude/CLAUDE.md §10 の方針）。
 */

/** メートル/度（緯度方向）。WGS84 の平均的近似。 */
const METERS_PER_DEG_LAT = 111_320

/** GeoJSON Polygon（MapLibre / GeoJSON の Geometry にそのまま渡せる形）。 */
export type CirclePolygon = {
  type: 'Polygon'
  coordinates: [number, number][][]
}

/** 経緯度の 1 点。 */
export type LonLat = {
  readonly lon: number
  readonly lat: number
}

/**
 * 中心から半径 `radiusM` の円周上に、等間隔の点を並べる。
 * 経度方向は緯度による収束（cos）を補正。小さめの半径（≤20km）で十分な近似。
 *
 * 半径サークルの描画と、**区域の縁を確かめる周囲サンプル**（§6.3・避難先の重なり判定）で共用する。
 */
export function ringAround(
  lon: number,
  lat: number,
  radiusM: number,
  segments: number,
): readonly LonLat[] {
  const dLat = radiusM / METERS_PER_DEG_LAT
  const dLon = radiusM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  return Array.from({ length: segments }, (_unused, index) => {
    const angle = (2 * Math.PI * index) / segments
    return { lon: lon + dLon * Math.cos(angle), lat: lat + dLat * Math.sin(angle) }
  })
}

/**
 * 中心 (lon, lat) から半径 `radiusM`（メートル）の円ポリゴンを生成する。
 * リングは閉じる（先頭と末尾が一致）。
 */
export function circlePolygon(
  lon: number,
  lat: number,
  radiusM: number,
  segments = 64,
): CirclePolygon {
  const ring: [number, number][] = ringAround(lon, lat, radiusM, segments).map((point) => [
    point.lon,
    point.lat,
  ])
  const first = ring[0]
  if (first) ring.push(first) // リングを閉じる
  return { type: 'Polygon', coordinates: [ring] }
}

// --- ウェブメルカトルのタイル座標（XYZ） ---------------------------------

/** 1 タイルの画素数（XYZ タイルの標準）。 */
export const TILE_PIXELS = 256

/** タイル内の位置（タイル番号 ＋ タイル内の画素）。 */
export type TilePixel = {
  readonly x: number
  readonly y: number
  readonly px: number
  readonly py: number
}

/**
 * 経緯度 → XYZ タイル番号とタイル内の画素（ウェブメルカトル・EPSG:3857）。
 *
 * 公式ハザードタイルの**画素の色**を読むために使う（`docs/260824_flood.md` §6.3 の ②）。
 * 検証スクリプト（`pipeline/validate_hazard_mesh.py` の `tile_xy`）と同じ式で、
 * 両者がずれると「検証は通るのに本番だけ隣の画素を読む」が起きる。
 */
export function tilePixelOf(lon: number, lat: number, zoom: number): TilePixel {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 24) {
    throw new Error(`ズームは 0–24 の整数（受領: ${zoom}）`)
  }
  const scale = 2 ** zoom * TILE_PIXELS
  const worldX = ((lon + 180) / 360) * scale
  const sin = Math.sin((lat * Math.PI) / 180)
  const worldY = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  return {
    x: Math.floor(worldX / TILE_PIXELS),
    y: Math.floor(worldY / TILE_PIXELS),
    px: Math.floor(worldX) % TILE_PIXELS,
    py: Math.floor(worldY) % TILE_PIXELS,
  }
}

// --- 距離と範囲 -----------------------------------------------------------

/** 地球の平均半径（メートル）。 */
const EARTH_RADIUS_M = 6_371_008.8

/**
 * 2 点間の大円距離（メートル・ハバーサイン）。
 *
 * 避難先の「◯m」「◯km」はこの 1 本だけで出す。平面近似（緯度でスケールした直交距離）でも
 * 数 km なら誤差は小さいが、**避難の話で「近い順」を作る計算に近似を混ぜたくない**
 * ——順位が入れ替わる可能性を残すより、素直に球面で解く方が説明しやすい。
 */
export function distanceM(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const deltaLat = toRad(toLat - fromLat)
  const deltaLon = toRad(toLon - fromLon)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 経緯度の矩形（west, south, east, north）。 */
export type BoundingBox = {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

/**
 * 矩形に余裕を持たせる割合。
 *
 * `METERS_PER_DEG_LAT`（111,320）は赤道寄りの近似で、中緯度の子午線 1 度は
 * これより**短い**（35 度で約 110,940m）。そのまま割ると矩形が半径より 0.1% ほど**内側**に来る
 * ——実測 5,000m 指定で 4,994m だった。避難先を探す矩形でこれを放置すると、
 * **端にある行き先を取りこぼす**。取りこぼすくらいならタイルを 1 枚多く取る方がよい。
 */
const BOX_MARGIN = 1.01

/**
 * 中心から半径 `radiusM` を**必ず含む**矩形。
 * タイルを何枚取りに行くかを決めるのに使うので、**足りないより多い方**へ倒す（緯度の cos は端で取る）。
 */
export function boundingBoxAround(lon: number, lat: number, radiusM: number): BoundingBox {
  const dLat = (radiusM * BOX_MARGIN) / METERS_PER_DEG_LAT
  const widestLat = Math.min(89, Math.abs(lat) + dLat)
  const dLon = (radiusM * BOX_MARGIN) / (METERS_PER_DEG_LAT * Math.cos((widestLat * Math.PI) / 180))
  return { west: lon - dLon, south: lat - dLat, east: lon + dLon, north: lat + dLat }
}

/** XYZ のタイル番号 1 枚。 */
export type TileIndex = {
  readonly x: number
  readonly y: number
}

/**
 * 矩形に重なる XYZ タイルを列挙する（そのズームのタイル番号）。
 * **枚数は呼び出し側が制限する**——ここでは矩形どおりに返す。
 */
export function tilesCovering(box: BoundingBox, zoom: number): readonly TileIndex[] {
  const topLeft = tilePixelOf(box.west, box.north, zoom)
  const bottomRight = tilePixelOf(box.east, box.south, zoom)
  const limit = 2 ** zoom - 1
  const clamp = (value: number): number => Math.min(limit, Math.max(0, value))
  const tiles: TileIndex[] = []
  for (let x = clamp(topLeft.x); x <= clamp(bottomRight.x); x += 1) {
    for (let y = clamp(topLeft.y); y <= clamp(bottomRight.y); y += 1) {
      tiles.push({ x, y })
    }
  }
  return tiles
}
