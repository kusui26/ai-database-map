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

/**
 * 中心 (lon, lat) から半径 `radiusM`（メートル）の円ポリゴンを生成する。
 * 経度方向は緯度による収束（cos）を補正。小さめの半径（≤20km）での表示用途に十分な近似。
 * リングは閉じる（先頭と末尾が一致）。
 */
export function circlePolygon(
  lon: number,
  lat: number,
  radiusM: number,
  segments = 64,
): CirclePolygon {
  const latRad = (lat * Math.PI) / 180
  const dLat = radiusM / METERS_PER_DEG_LAT
  const dLon = radiusM / (METERS_PER_DEG_LAT * Math.cos(latRad))

  const ring: [number, number][] = []
  for (let i = 0; i < segments; i += 1) {
    const angle = (2 * Math.PI * i) / segments
    ring.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)])
  }
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
