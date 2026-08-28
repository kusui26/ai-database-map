/**
 * 「どちらへ動けば区域の外か」を組み立てる（`docs/260824_flood.md` §8.6）。
 *
 * `GET /api/hazard/escape` と **AI ツール `findEscapeDirection` の両方がここを通る**
 * （`point-source.ts` / `evacuation-source.ts` と同じ流儀）。
 *
 * ## 通信は「必要になってから」広げる
 *
 * 配布メッシュは 1 次メッシュ（約 80km 四方）ごとのタイルである。区域の外はたいてい
 * **同じタイルの中**にあるので、まず**その 1 枚だけ**で探す。見つからず、かつ
 * 読めなかったセルがあったときだけ、**周囲 8 枚**を足してもう一度探す。
 * こうすると、ほとんどの問い合わせで追加の取得が 0 枚で済む。
 *
 * ## 「読めなかった」を「区域の外」にしない
 *
 * 載せていないタイルのセルは `'unknown'` を返す。**外と混ぜると、タイルの端が
 * いつでも「出口」になってしまう**（§7.5-1）。
 */

import { HAZARD_DISCLAIMER_JA, getHazardLayer } from '@/shared/hazard'
import {
  evacuationDisasterLabelJa,
  EVACUATION_AREA_LAYERS,
  type EvacuationDisasterKey,
} from '@/shared/evacuation'
import {
  meshCellFromLonLat,
  meshCenterOfIndices,
  meshIndicesFromLonLat,
  MESH_SIZE_M,
  surroundingPrimaries,
  type LonLat,
  type MeshIndices,
} from '@/shared/mesh'
import { cellAt } from '@/shared/hazard-mesh'
import { officialTileSample } from './officialTiles'
import type { HazardEscapeResponse } from '@/shared/api'
import type { SourceRef } from '@/shared/protocol'
import {
  escapeHeadlineJa,
  escapeUnavailableJa,
  nearestOutsideCell,
  outsideAlreadyJa,
  ESCAPE_LIMITATIONS_JA,
  ESCAPE_OFFLINE_NOTE_JA,
  type EscapeCell,
  type EscapeSearchResult,
} from '@/domain/hazard/escape'
import { hazardMeshTile } from './meshTiles'

/** 探す上限（セル数）。250m × 80 ＝ 20km。徒歩でも車でも、これ以上は方向の話にならない。 */
const MAX_RADIUS_CELLS = 80

/**
 * 見つけた出口を**公式タイルで確かめる**回数の上限。
 *
 * ⚠ **メッシュだけでは足りない。** 実測（2026-08-27・亀有駅）で、メッシュが「区域の外」と
 * 言ったセルを `/api/hazard/point` に投げると **`caution`／洪水に該当**が返った。
 * 原典どうしの差で**メッシュが公式タイルより薄い**ためで、§11 のリスク 7c そのものである。
 * 「地図は塗られているのに、そちらへ向かえと言う」ことになるので、
 * §6.3 の優先順位（タイル ＞ メッシュ）を出口にも当てる。
 *
 * 落ちたセルを「区域内」に読み替えて探し直す。数回で収まる（1 回で決まることがほとんど）。
 */
const MAX_TILE_CHECKS = 6

/** 呼び名の既定。 */
export const DEFAULT_PLACE_JA = 'この地点'

const SOURCES: readonly SourceRef[] = [
  {
    labelJa: '出典：国土数値情報（洪水浸水想定区域 A31b・雨水出水浸水想定区域 A51）を 250m メッシュに集計',
    url: 'https://nlftp.mlit.go.jp/ksj/',
    license: '国土数値情報 利用約款',
    forJa: null,
  },
]

export type HazardEscapeRequest = {
  readonly lon: number
  readonly lat: number
  readonly placeJa?: string
  readonly disaster: EvacuationDisasterKey
  /**
   * 公式タイルに届くか（既定 true）。**オフラインでは false**。
   *
   * 通信できないとき、**メッシュだけで答えることはできる**（配布タイルは端末にある）。
   * ただし「公式の地図でも塗られていないか」の確認ができないので、
   * §11 リスク 7c（メッシュは公式タイルより薄い）の分だけ答えが甘くなる。
   * **黙って甘い答えを返さない**ために、注記に残す。
   */
  readonly online?: boolean
}

/** その災害の区域のうち、**自前メッシュで読めるもの**（洪水・内水だけ・決定 4）。 */
function meshLayerKeysFor(disaster: EvacuationDisasterKey): readonly string[] {
  return EVACUATION_AREA_LAYERS[disaster].filter(
    (key) => getHazardLayer(key)?.mesh?.available === true,
  )
}

/** 載せたタイル（`レイヤ key + 1 次メッシュ` → バイト列）。 */
type LoadedTiles = ReadonlyMap<string, Uint8Array>

function tileKey(layerKey: string, primary: string): string {
  return `${layerKey}/${primary}`
}

/** 指定した 1 次メッシュぶんのタイルを載せる（無いものは載らない＝`unknown` になる）。 */
async function loadTiles(
  layerKeys: readonly string[],
  primaries: readonly string[],
  baseUrl: string,
): Promise<LoadedTiles> {
  const wanted = layerKeys.flatMap((layerKey) =>
    primaries.map((primary) => ({ layerKey, primary })),
  )
  const loaded = await Promise.all(
    wanted.map(async (each) => ({
      ...each,
      bytes: await hazardMeshTile(each.layerKey, each.primary, baseUrl).catch(() => null),
    })),
  )
  return new Map(
    loaded.flatMap((each) =>
      each.bytes === null ? [] : [[tileKey(each.layerKey, each.primary), each.bytes] as const],
    ),
  )
}

/**
 * 格子の読み取り（同期）。**1 レイヤでも「かかる」なら区域内**、
 * すべて被覆率 0 なら区域外、1 枚も載っていなければ「分からない」。
 */
function probeWith(tiles: LoadedTiles, layerKeys: readonly string[]) {
  return (indices: MeshIndices): EscapeCell => {
    const centre = meshCenterOfIndices(indices)
    const cell = meshCellFromLonLat(centre.lon, centre.lat)
    let read = 0
    for (const layerKey of layerKeys) {
      const bytes = tiles.get(tileKey(layerKey, cell.primary))
      if (bytes === undefined) continue
      read += 1
      if (cellAt(bytes, cell).coverage > 0) return 'inside'
    }
    return read === 0 ? 'unknown' : 'outside'
  }
}

/** その災害の区域のうち、**公式タイルで確かめられるもの**。 */
function tileLayerKeysFor(disaster: EvacuationDisasterKey): readonly string[] {
  return EVACUATION_AREA_LAYERS[disaster].filter((key) => getHazardLayer(key)?.tile != null)
}

/**
 * そのセルの中心が、公式タイルでも塗られていないか。
 * **届かなかったときは `true`（＝否定しない）**——証拠の不在でメッシュの答えを覆さない。
 */
async function outsideOnTiles(centre: LonLat, layerKeys: readonly string[]): Promise<boolean> {
  const samples = await Promise.all(
    layerKeys.map((layerKey) =>
      officialTileSample(layerKey, centre.lon, centre.lat).catch(() => ({
        reached: false,
        hex: null,
      })),
    ),
  )
  return samples.every((sample) => sample.hex === null)
}

/**
 * メッシュで探し、**公式タイルで確かめてから**返す（§6.3 の優先順位）。
 * 落ちたセルは「区域内」に読み替えて探し直す。
 */
async function searchVerified(
  origin: LonLat,
  start: MeshIndices,
  probe: (indices: MeshIndices) => EscapeCell,
  tileLayerKeys: readonly string[],
): Promise<EscapeSearchResult & { rejected: number }> {
  // 公式タイルに届かない（オフライン）なら、確認そのものを飛ばす。
  // 届かない前提で 6 回探し直しても答えは変わらず、待たせるだけになる。
  if (tileLayerKeys.length === 0) {
    return { ...nearestOutsideCell(origin, start, probe, MAX_RADIUS_CELLS), rejected: 0 }
  }
  const rejected = new Set<string>()
  const key = (indices: MeshIndices): string => `${indices.latIndex}/${indices.lonIndex}`
  for (let attempt = 0; attempt < MAX_TILE_CHECKS; attempt += 1) {
    const guarded = (indices: MeshIndices): EscapeCell =>
      rejected.has(key(indices)) ? 'inside' : probe(indices)
    const found = nearestOutsideCell(origin, start, guarded, MAX_RADIUS_CELLS)
    if (found.target === null) return { ...found, rejected: rejected.size }
    if (await outsideOnTiles(found.target.centre, tileLayerKeys)) {
      return { ...found, rejected: rejected.size }
    }
    rejected.add(key(found.target.indices))
  }
  return {
    target: null,
    sawUnknown: true,
    searchedRadiusCells: MAX_RADIUS_CELLS,
    rejected: rejected.size,
  }
}

/** 探した結果に添える注記（黙って打ち切らない）。 */
function escapeNotesJa(
  result: EscapeSearchResult & { rejected: number },
  online: boolean,
): readonly string[] {
  return [
    ...(online ? [] : [ESCAPE_OFFLINE_NOTE_JA]),
    ...(result.target === null && result.sawUnknown
      ? ['探した範囲に、メッシュを読めない区画がありました。**区域の外が無いという意味ではありません**。']
      : []),
    ...(result.rejected > 0
      ? [
          `メッシュでは区域の外だが**公式の地図では塗られている**区画を ${result.rejected} 件とばしました（地図の方を採っています）。`,
        ]
      : []),
  ]
}

/** 応答の共通部分（見つからなかったときも同じ形で返す）。 */
function baseResponse(
  request: HazardEscapeRequest,
  placeJa: string,
  areaLabelJa: string,
  headlineJa: string,
  notesJa: readonly string[],
): HazardEscapeResponse {
  return {
    point: { lon: request.lon, lat: request.lat, placeJa },
    forDisaster: request.disaster,
    forDisasterJa: areaLabelJa,
    // 既定は「判定できない」。分かったときだけ呼び出し側が上書きする。
    inside: null,
    direction: null,
    searchRadiusM: MAX_RADIUS_CELLS * MESH_SIZE_M,
    headlineJa,
    limitationsJa: [...ESCAPE_LIMITATIONS_JA],
    notesJa: [...notesJa],
    sources: [...SOURCES],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
}

/**
 * その地点から、いちばん近い「区域の外」の向きと距離。
 *
 * **経路ではなく方向だけ**を返す（§0.4・§8.6）。道路の冠水は見ていないので、
 * 文言は必ず「参考」に留める。
 */
export async function escapeDirectionAt(
  request: HazardEscapeRequest,
  baseUrl = '',
): Promise<HazardEscapeResponse> {
  const placeJa = request.placeJa ?? DEFAULT_PLACE_JA
  const areaLabelJa = `${evacuationDisasterLabelJa(request.disaster)}の想定区域`
  const layerKeys = meshLayerKeysFor(request.disaster)
  if (layerKeys.length === 0) {
    const reason = `${evacuationDisasterLabelJa(request.disaster)}は 250m メッシュを持っていません`
    return baseResponse(
      request,
      placeJa,
      areaLabelJa,
      escapeUnavailableJa(placeJa, areaLabelJa, reason),
      ['メッシュ化しているのは洪水と内水だけです（決定 4）。'],
    )
  }

  const origin = { lon: request.lon, lat: request.lat }
  const start = meshIndicesFromLonLat(origin.lon, origin.lat)
  const home = meshCellFromLonLat(origin.lon, origin.lat).primary
  const homeTiles = await loadTiles(layerKeys, [home], baseUrl)
  const homeProbe = probeWith(homeTiles, layerKeys)

  const here = homeProbe(start)
  if (here === 'unknown') {
    return baseResponse(
      request,
      placeJa,
      areaLabelJa,
      escapeUnavailableJa(placeJa, areaLabelJa, 'この地域の 250m メッシュを読めませんでした'),
      ['配布していない区画の可能性があります。**区域の外という意味ではありません**。'],
    )
  }
  if (here === 'outside') {
    return {
      ...baseResponse(request, placeJa, areaLabelJa, outsideAlreadyJa(placeJa, areaLabelJa), []),
      inside: false,
    }
  }

  // まず自分のタイルだけで探す。**ほとんどはここで見つかる**（区域は 80km も続かない）。
  const probe =
    nearestOutsideCell(origin, start, homeProbe, MAX_RADIUS_CELLS).target !== null
      ? homeProbe
      : probeWith(
          await loadTiles(layerKeys, surroundingPrimaries(origin.lon, origin.lat), baseUrl),
          layerKeys,
        )
  const online = request.online ?? true
  const result = await searchVerified(
    origin,
    start,
    probe,
    online ? tileLayerKeysFor(request.disaster) : [],
  )

  const searchedM = result.searchedRadiusCells * MESH_SIZE_M
  return {
    ...baseResponse(
      request,
      placeJa,
      areaLabelJa,
      escapeHeadlineJa(placeJa, areaLabelJa, result.target, searchedM),
      escapeNotesJa(result, online),
    ),
    inside: true,
    direction:
      result.target === null
        ? null
        : {
            bearingJa: result.target.bearingJa,
            distanceM: result.target.distanceM,
            distanceJa: result.target.distanceJa,
            lon: result.target.centre.lon,
            lat: result.target.centre.lat,
          },
  }
}
