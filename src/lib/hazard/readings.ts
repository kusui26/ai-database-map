/**
 * 地点の**読み取り**（意味づけをしない層）。サーバとブラウザで同じコードが動く。
 *
 * ここがやるのは「バイトと画素を、レイヤごとの生の値にする」ところまで。
 * それが何を意味するか（危険度・行動・言い方）は `domain/hazard/point` が決める
 * （`docs/260824_flood.md` §6.1・§8.3）。分けておくと、
 * **オフラインではメッシュだけを読んで同じドメイン関数に渡す**という形が素直に書ける。
 */

import { ringAround } from '@/shared/geo'
import { cellAt, elevationAtCell } from '@/shared/hazard-mesh'
import { isCellIndex, meshCellFromLonLat, type MeshCell } from '@/shared/mesh'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import type { AreaTileReading } from '@/domain/hazard/evacuation'
import type { MeshReading, TileReading } from '@/domain/hazard/point'
import { elevationMeshTile, hazardMeshIndex, hazardMeshTile } from './meshTiles'
import { officialTileHex, officialTileSample, POINT_QUERY_ZOOM } from './officialTiles'

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

// --- 区域との重なり（避難先の判定・§6.3） --------------------------------

/**
 * 区域の縁を確かめる半径（メートル）。
 *
 * 公式タイルは境界の画素で色が混ざり（実測：塗り `#E6C832` に対し縁は `#E6C732`）、
 * 完全一致だけを採る規約（§10.2 ③）では縁に立つと「該当なし」になる。
 * また避難場所の座標は建物の代表点なので、**敷地の広がりぶんの余裕**も要る。
 * 20m は「隣が区域なら知らせるが、通り 1 本向こうまでは含めない」距離として選んだ。
 */
const NEARBY_RADIUS_M = 20

/** 周囲を確かめる方位の数（八方位）。 */
const NEARBY_SAMPLES = 8

/**
 * 粗いズーム。**「塗られていない」と「タイルが無い」を見分ける**ために引く。
 *
 * z10 は約 40km 四方。ここにタイルがあれば「この一帯には区域図がある」と分かるので、
 * z16 の 404 は「**この区画に塗るものが無い**」＝区域外と読める。
 * どちらのズームも無ければ、区域が無いのか未整備なのかは分からない
 * （実測 2026-08-27：富山県の内水は z16・z10 とも 404 ＝未整備。
 * 熱海の海上は z16 404・z10 200 ＝区域外）。
 */
const COARSE_ZOOM = 10

export type AreaTileReadingsResult = {
  readonly readings: readonly AreaTileReading[]
  /**
   * 画素は読めなかったが、**粗いズームには一帯のデータがあった**か。
   * これが真なら「この区画には塗るものが無い」＝区域外と読んでよい。
   */
  readonly absentButCovered: boolean
  readonly noteJa: string | null
}

/** 1 レイヤぶんの読み取り（点 → 届かなければ粗いズームで一帯の有無を見る）。 */
async function readAreaLayer(
  layerKey: string,
  lon: number,
  lat: number,
): Promise<{ reading: AreaTileReading; covered: boolean }> {
  const point = await officialTileSample(layerKey, lon, lat, POINT_QUERY_ZOOM)
  if (!point.reached) {
    const coarse = await officialTileSample(layerKey, lon, lat, COARSE_ZOOM)
    return {
      reading: { layerKey, reached: false, hexAtPoint: null, hexNearby: null },
      covered: coarse.reached,
    }
  }
  if (point.hex !== null) {
    return {
      reading: { layerKey, reached: true, hexAtPoint: point.hex, hexNearby: null },
      covered: true,
    }
  }
  // 点は塗られていない。**縁に立っていないか**を周囲で確かめる。
  const ring = ringAround(lon, lat, NEARBY_RADIUS_M, NEARBY_SAMPLES)
  const samples = await Promise.all(
    ring.map((point) => officialTileSample(layerKey, point.lon, point.lat, POINT_QUERY_ZOOM)),
  )
  const nearby = samples.find((sample) => sample.hex !== null)?.hex ?? null
  return {
    reading: { layerKey, reached: true, hexAtPoint: null, hexNearby: nearby },
    covered: true,
  }
}

/**
 * その地点と、指定したレイヤの区域との重なりを**公式タイルの画素**で読む（§6.3 の ②）。
 *
 * 意味づけ（どの階級か・区域内と言い切れるか）は `domain/hazard/evacuation` が行う。
 * ここは「画素と、届いたかどうか」を返すだけである。
 */
export async function areaTileReadings(
  lon: number,
  lat: number,
  layerKeys: readonly string[],
): Promise<AreaTileReadingsResult> {
  if (layerKeys.length === 0) {
    return { readings: [], absentButCovered: false, noteJa: null }
  }
  const results = await Promise.allSettled(
    layerKeys.map((layerKey) => readAreaLayer(layerKey, lon, lat)),
  )
  const settled = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const failed = results.length - settled.length
  return {
    readings: settled.map((each) => each.reading),
    // **1 レイヤでも「一帯にデータが無い」なら、区域外とは言わない**（安全側に倒す）。
    absentButCovered: settled.length > 0 && settled.every((each) => each.covered),
    noteJa: failed === 0 ? null : `公式タイルを ${failed} レイヤぶん取得できませんでした`,
  }
}
