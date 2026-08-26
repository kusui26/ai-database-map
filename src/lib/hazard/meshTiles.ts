/**
 * 配布メッシュ（`public/hazard/**`）を読む（**サーバとブラウザで同じコード**）。
 *
 * `fetch` と `DecompressionStream` はどちらの環境にもあるので、取得経路を分けない。
 * 分けた瞬間に「オンラインとオフラインで違うことを言う」余地が生まれる
 * （`docs/260824_flood.md` §8.3）。意味づけは一切せず、**バイト列を返すだけ**。
 *
 * - サーバからは `baseUrl` にデプロイの origin を渡す（CDN が配るので関数バンドルに載せない）
 * - ブラウザからは `baseUrl` を省く（相対 URL・Service Worker がキャッシュを返す）
 */

import {
  ELEVATION_TILE_BYTES,
  HAZARD_TILE_BYTES,
  parseHazardMeshIndex,
  type HazardMeshIndex,
} from '@/shared/hazard-mesh'
import { createLru, remember } from '@/lib/lru'

/** 配布物の置き場（`public/hazard/`）。 */
const HAZARD_BASE_PATH = '/hazard'
/** 取得のタイムアウト。静的アセットなので短くてよい。 */
const FETCH_TIMEOUT_MS = 6_000
/** タイルのキャッシュ枚数（1 枚 100KB・標高は 200KB）。 */
const TILE_CACHE_CAPACITY = 48

const tiles = createLru<string, Promise<Uint8Array | null>>(TILE_CACHE_CAPACITY)
const indexes = createLru<string, Promise<HazardMeshIndex>>(4)

/** gzip の魔法数。CDN が展開して返す場合もあるので、**中身を見て**判断する。 */
const GZIP_MAGIC = [0x1f, 0x8b]

function isGzipped(bytes: Uint8Array): boolean {
  return GZIP_MAGIC.every((byte, index) => bytes[index] === byte)
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** タイムアウト付きの取得。404（配布していない区画）は**正常**なので null を返す。 */
async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`取得に失敗しました（${response.status}）: ${url}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return isGzipped(bytes) ? await gunzip(bytes) : bytes
  } finally {
    clearTimeout(timer)
  }
}

/** 配布アーティファクトの索引。**版と規約の一致まで検証**して返す（ずれたら読まない）。 */
export function hazardMeshIndex(baseUrl = ''): Promise<HazardMeshIndex> {
  const url = `${baseUrl}${HAZARD_BASE_PATH}/index.json`
  return remember(indexes, url, async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok)
        throw new Error(`ハザード索引を取得できません（${response.status}）: ${url}`)
      return parseHazardMeshIndex(await response.json())
    } finally {
      clearTimeout(timer)
    }
  })
}

/** バイト数が規約どおりかを確かめる（違えば読まずに落とす＝隣のセルの値を返さない）。 */
function verifySize(bytes: Uint8Array | null, expected: number, url: string): Uint8Array | null {
  if (bytes === null) return null
  if (bytes.byteLength !== expected) {
    throw new Error(`タイルの大きさが規約と違います（${bytes.byteLength}/${expected}）: ${url}`)
  }
  return bytes
}

function loadTile(url: string, expected: number): Promise<Uint8Array | null> {
  return remember(tiles, url, async () => verifySize(await fetchBytes(url), expected, url))
}

/** ハザードのメッシュタイル（1 セル 1 バイト・102,400）。配布が無ければ null。 */
export function hazardMeshTile(
  layerKey: string,
  primary: string,
  baseUrl = '',
): Promise<Uint8Array | null> {
  return loadTile(`${baseUrl}${HAZARD_BASE_PATH}/${layerKey}/${primary}.bin.gz`, HAZARD_TILE_BYTES)
}

/** 標高タイル（int16 リトルエンディアン・デシメートル）。配布が無ければ null。 */
export function elevationMeshTile(primary: string, baseUrl = ''): Promise<Uint8Array | null> {
  return loadTile(
    `${baseUrl}${HAZARD_BASE_PATH}/terrain/elev/${primary}.bin.gz`,
    ELEVATION_TILE_BYTES,
  )
}

/** テスト用：キャッシュを空にする。 */
export function clearMeshTileCache(): void {
  tiles.clear()
  indexes.clear()
}
