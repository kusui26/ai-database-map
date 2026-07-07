/**
 * 空間ユーティリティ（純関数・依存なし）。
 * 半径サークルの GeoJSON 生成など。turf 等に依存せず自前で描く（.claude/CLAUDE.md §10 の方針）。
 */

/** メートル/度（緯度方向）。WGS84 の平均的近似。 */
const METERS_PER_DEG_LAT = 111_320

/** GeoJSON Polygon（MapLibre のソースにそのまま渡せる最小形）。 */
export type CirclePolygon = {
  readonly type: 'Polygon'
  readonly coordinates: readonly (readonly (readonly [number, number])[])[]
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
