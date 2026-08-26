/**
 * 地点の**読み取り**（意味づけをしない層）。サーバとブラウザで同じコードが動く。
 *
 * ここがやるのは「バイトと画素を、レイヤごとの生の値にする」ところまで。
 * それが何を意味するか（危険度・行動・言い方）は `domain/hazard/point` が決める
 * （`docs/260824_flood.md` §6.1・§8.3）。分けておくと、
 * **オフラインではメッシュだけを読んで同じドメイン関数に渡す**という形が素直に書ける。
 */

import { cellAt, elevationAtCell } from '@/shared/hazard-mesh'
import { isCellIndex, meshCellFromLonLat, type MeshCell } from '@/shared/mesh'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import type { MeshReading, TileReading } from '@/domain/hazard/point'
import { elevationMeshTile, hazardMeshIndex, hazardMeshTile } from './meshTiles'
import { officialTileHex } from './officialTiles'

/** 隣接セルの相対位置（周囲 8 マス）。同じタイル内に収まるものだけを見る。 */
const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
]

export type MeshReadingsResult = {
  readonly mesh: readonly MeshReading[]
  readonly elevationM: number | null
  readonly noteJa: string | null
}

/**
 * 周囲 8 セルの最大ランク。**1 次メッシュの縁では、はみ出す分を見ない**——
 * 隣のタイルを 8 枚取りに行く価値は無く（`docs/260824_flood.md` §8.3）、
 * 見落としても中心セルの答えは変わらないため。
 */
function neighbourMax(tile: Uint8Array, cell: MeshCell): number {
  return NEIGHBOUR_OFFSETS.reduce((worst, [dr, dc]) => {
    const [row, col] = [cell.row + dr, cell.col + dc]
    if (!isCellIndex(row) || !isCellIndex(col)) return worst
    return Math.max(worst, cellAt(tile, { primary: cell.primary, row, col }).rank)
  }, 0)
}

/** 1 レイヤぶんを読む（配布が無い区画は何も返さない）。 */
async function readLayer(
  layerKey: string,
  cell: MeshCell,
  baseUrl: string,
): Promise<readonly MeshReading[]> {
  const tile = await hazardMeshTile(layerKey, cell.primary, baseUrl)
  if (tile === null) return []
  const here = cellAt(tile, cell)
  return [
    {
      layerKey,
      sourceCode: here.rank,
      coverage: here.coverage,
      neighbourSourceCode: neighbourMax(tile, cell),
    },
  ]
}

/**
 * 自前メッシュから、その地点のセルと周囲 8 セルを読む。
 * **ここだけがオフラインでも動く**ので、失敗しても throw せず注記にして返す。
 */
export async function meshReadings(
  lon: number,
  lat: number,
  baseUrl = '',
): Promise<MeshReadingsResult> {
  const cell = meshCellFromLonLat(lon, lat)
  try {
    const index = await hazardMeshIndex(baseUrl)
    const keys = Object.entries(index.layers)
      .filter(([, meta]) => meta.primaries.includes(cell.primary))
      .map(([key]) => key)
    const [readings, elevation] = await Promise.all([
      Promise.all(keys.map((key) => readLayer(key, cell, baseUrl))),
      elevationMeshTile(cell.primary, baseUrl),
    ])
    return {
      mesh: readings.flat(),
      elevationM: elevation === null ? null : elevationAtCell(elevation, cell),
      noteJa: null,
    }
  } catch (error) {
    console.error(`ハザードメッシュを読めませんでした（${cell.primary}）`, error)
    return { mesh: [], elevationM: null, noteJa: '250m メッシュを読み込めませんでした' }
  }
}

export type TileReadingsResult = {
  readonly tile: readonly TileReading[]
  readonly noteJa: string | null
  /** 1 レイヤでも公式タイルに届いたか（届いていなければ答えは `unknown`）。 */
  readonly reached: boolean
}

/**
 * 公式タイルの画素を全レイヤぶん読む（**塗られていた画素だけ**を返す）。
 * 1 枚でも届けばオンライン扱いにする——全滅したときだけメッシュだけの答えになる。
 */
export async function tileReadings(lon: number, lat: number): Promise<TileReadingsResult> {
  const keys = hazardLayersWithPointAnswer()
  const results = await Promise.allSettled(
    keys.map(async (layerKey) => ({ layerKey, hex: await officialTileHex(layerKey, lon, lat) })),
  )
  const settled = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const tile = settled.flatMap(({ layerKey, hex }) => (hex === null ? [] : [{ layerKey, hex }]))
  const failed = results.length - settled.length
  return {
    tile,
    reached: settled.length > 0,
    noteJa: failed === 0 ? null : `公式タイルを ${failed} レイヤぶん取得できませんでした`,
  }
}
