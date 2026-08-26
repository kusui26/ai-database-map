/**
 * 公式ハザードタイル（重ねるハザードマップ）の**画素の色**を読む
 * （`docs/260824_flood.md` §6.3 の優先順位 ②）。
 *
 * これが効くのは「**地図に描いてある色と必ず一致する**」から。自前メッシュだけで答えると
 * 「地図は白いのにカードは浸水域」という矛盾が起きるが、同じ画素を読めば原理的に起きない。
 * さらに、原典どうしの差でメッシュが薄い区画（実測 1.7%・§8.2b）も、**オンラインならここが埋める**。
 *
 * 色 → 階級の対応は**カタログが唯一の正**（`hazardRankOfColor`）。ここは画素を返すだけ。
 */

import { getHazardLayer } from '@/shared/hazard'
import { hexOf, decodePng, pixelAt, type DecodedImage } from '@/shared/png'
import { tilePixelOf } from '@/shared/geo'
import { createLru, remember } from '@/lib/lru'

/**
 * 地点を問い合わせるズーム。z16 なら 1 画素 ≒ 1.9m で、GPS 誤差（5–50m）より十分に細かい。
 * 配信は z17 まであるので、上限を超えることはない。
 */
export const POINT_QUERY_ZOOM = 16
const FETCH_TIMEOUT_MS = 4_000
/** 展開済み画像のキャッシュ枚数（1 枚 256×256×4 ＝ 262KB）。 */
const IMAGE_CACHE_CAPACITY = 24

const images = createLru<string, Promise<DecodedImage | null>>(IMAGE_CACHE_CAPACITY)

/** タイル URL を組み立てる（未知のレイヤ・タイル無しは null）。 */
function tileUrl(layerKey: string, x: number, y: number, zoom: number): string | null {
  const tile = getHazardLayer(layerKey)?.tile
  if (tile == null || zoom < tile.minZoom || zoom > tile.maxZoom) return null
  return tile.url.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** 1 枚取得して展開する。**404 は「その区画にデータが無い」＝正常**なので null。 */
async function loadImage(url: string): Promise<DecodedImage | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`公式タイルを取得できません（${response.status}）: ${url}`)
    return await decodePng(new Uint8Array(await response.arrayBuffer()))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * その地点の画素の色（`#RRGGBB`）。**透明・データ無しは null**。
 * 透明を「区域外」と解釈するのは呼び出し側（＝カタログを通して意味づけする側）の仕事。
 */
export async function officialTileHex(
  layerKey: string,
  lon: number,
  lat: number,
  zoom = POINT_QUERY_ZOOM,
): Promise<string | null> {
  const { x, y, px, py } = tilePixelOf(lon, lat, zoom)
  const url = tileUrl(layerKey, x, y, zoom)
  if (url === null) return null
  const image = await remember(images, url, () => loadImage(url))
  if (image === null) return null
  const pixel = pixelAt(image, px, py)
  return pixel.a === 0 ? null : hexOf(pixel)
}

/** テスト用：キャッシュを空にする。 */
export function clearOfficialTileCache(): void {
  images.clear()
}
