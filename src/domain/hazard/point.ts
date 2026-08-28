/**
 * ドメイン：**地点のハザードを 1 つの意味づけ済みの形にまとめる**（純関数）。
 *
 * `docs/260824_flood.md` §6.1・§8.3。ここが Phase 2 の心臓部で、
 * **サーバ（`/api/hazard/point`）とブラウザ（オフライン）が同じこの関数を通る**。
 * 二重実装にすると、機内モードとオンラインで違うことを言うアプリになる。
 *
 * ## 情報源は「良いものから順に」（§6.3）
 *
 * | 順 | 情報源 | 何が良いか |
 * |--:|---|---|
 * | ① | **浸水ナビ**（洪水・想定最大規模） | 実測の **m**。どの川が・何分後に・何日続くまで言える |
 * | ② | **公式タイルの画素** | **地図に描いてある色と必ず一致**。全ハザードに効く |
 * | ③ | **自前 250m メッシュ** | 唯一**オフラインで動く**。点ではなく**区間**を返す |
 *
 * **③ の区間は必ず ①② を含む**（乱点 10,000 点で確認済み・§8.2b）ので、
 * どの順で採っても矛盾しない。採ったものは `source` として必ず応答に残す。
 *
 * ## 入力は「読み取り」まで、意味づけはここ
 *
 * 取得（fetch・タイムアウト・キャッシュ）は `lib/hazard/*` が持ち、この関数は
 * **読み取った生の値**（原典コード・画素の色・実測 m）だけを受け取る。
 * だから純関数のままテストでき、オフライン経路でもそのまま動く。
 */

import {
  getHazardLayer,
  HAZARD_DISCLAIMER_JA,
  type HazardCertainty,
  type HazardSource,
} from '@/shared/hazard'
import type { HazardItem, SourceRef } from '@/shared/protocol'
import type { HazardNeighbour, HazardPointResponse, HazardRiver, HazardVerdict } from '@/shared/api'
import { MESH_SIZE_M, meshCenterOf, meshCodeFromLonLat } from '@/shared/mesh'
import {
  HAZARD_GROUP_LABELS_JA,
  hazardLevelWeight,
  type HazardGroup,
  type HazardLevel,
} from '@/shared/constants'
import {
  hazardRankOfColor,
  hazardRankOfDepth,
  hazardRankOfSourceCode,
  type HazardPointRank,
} from './catalog'
import {
  certaintyOf,
  meshNoteJa,
  neighbourNoteJa,
  PROXIMITY_JA,
  riverReasonsJa,
  UNCOVERED_NOTE_JA,
  valuePhraseJa,
  weakestCertainty,
} from './wording'
import { SUIBOU_NAVI_SOURCE } from './sources'
import { hazardVerdict, type VerdictItem } from './verdict'

/** 自前メッシュから読んだ 1 レイヤぶん。 */
export type MeshReading = {
  readonly layerKey: string
  /** セル内の**最大**の原典コード（0 ＝ 該当なし）。真値は必ずこれ以下。 */
  readonly sourceCode: number
  /** 250m セルのうち区域が占める割合（0–1）。**0 と 1 だけが厳密**。 */
  readonly coverage: number
  /** 周囲 8 セルの最大の原典コード（「隣が区域」と言うため・§8.3）。 */
  readonly neighbourSourceCode: number
}

/** 公式タイルの画素から読んだ 1 レイヤぶん（**塗られていた画素だけ**が入る）。 */
export type TileReading = {
  readonly layerKey: string
  /** `#RRGGBB`（大文字・カタログの `ranks[].color` と同じ表記）。 */
  readonly hex: string
}

export type PointHazardInput = {
  readonly lon: number
  readonly lat: number
  readonly placeJa: string
  readonly mesh: readonly MeshReading[]
  readonly tile: readonly TileReading[]
  /**
   * その点は塗られていないが、**すぐ近く（約 20m）が区域**だったもの（§6.2 の追記）。
   * メッシュが隣接セルを教えてくれないレイヤ（土砂・高潮・津波）で効く。
   */
  readonly tileNearby: readonly TileReading[]
  /**
   * **この地域に区域図が無かった**レイヤ（粗いズームでも届かなかったもの）。
   * 全国の一般論ではなく「ここには無い」と言うために使う（§7.5-2）。
   */
  readonly uncoveredLayerKeys: readonly string[]
  readonly rivers: readonly HazardRiver[]
  /** 平均標高（m・無ければ null）。 */
  readonly elevationM: number | null
  /** オンラインの情報源に**一度でも届いたか**。届いていなければ答えは `unknown`。 */
  readonly online: boolean
  /** 取得できなかったものの説明（部分応答であることを隠さない）。 */
  readonly notesJa: readonly string[]
}

/** 浸水ナビの実測が対応するレイヤ（`CSVScale=0` ＝ 想定最大規模）。 */
const SUIBOU_NAVI_LAYER = 'flood_l2'

/** 1 レイヤぶんの解決結果（採用した情報源つき）。 */
type Resolved = {
  readonly rank: HazardPointRank
  readonly source: HazardSource
  readonly coverage: number | null
  readonly depthM: number | null
}

/** 浸水ナビの最大浸水深（m）。1 件も無ければ null。 */
function deepestRiver(rivers: readonly HazardRiver[]): number | null {
  const depths = rivers.flatMap((river) => (river.maxDepthM === null ? [] : [river.maxDepthM]))
  return depths.length === 0 ? null : Math.max(...depths)
}

/** ①→②→③ の順に、最初に答えられたものを採る。 */
function resolveLayer(
  layerKey: string,
  input: PointHazardInput,
  deepestM: number | null,
): Resolved | null {
  if (layerKey === SUIBOU_NAVI_LAYER && deepestM !== null && deepestM > 0) {
    const rank = hazardRankOfDepth(layerKey, deepestM)
    if (rank !== null) return { rank, source: 'suibou-navi', coverage: null, depthM: deepestM }
  }
  const painted = input.tile.find((reading) => reading.layerKey === layerKey)
  const fromTile = painted === undefined ? null : hazardRankOfColor(layerKey, painted.hex)
  if (fromTile !== null) return { rank: fromTile, source: 'tile', coverage: null, depthM: null }
  const cell = input.mesh.find((reading) => reading.layerKey === layerKey)
  const fromMesh = cell === undefined ? null : hazardRankOfSourceCode(layerKey, cell.sourceCode)
  if (fromMesh === null || cell === undefined) return null
  return { rank: fromMesh, source: 'mesh', coverage: cell.coverage, depthM: null }
}

/** 解決結果 → 応答の 1 行（表示に必要な意味づけをすべて済ませた形）。 */
function toItem(layerKey: string, resolved: Resolved): HazardItem | null {
  const layer = getHazardLayer(layerKey)
  if (layer === undefined) return null
  const { rank, source, coverage, depthM } = resolved
  return {
    layerKey,
    labelJa: layer.labelJa,
    valueJa: valuePhraseJa(rank.labelJa, source, depthM, coverage),
    meaningJa: rank.meaningJa,
    level: rank.level,
    color: rank.color,
    source,
    coverage,
    certainty: certaintyOf(source, coverage),
  }
}

/** 危険度の重い順（同じなら`カタログ順`＝入力順）に並べる。UI も AI も上から読む。 */
function byDangerFirst(items: readonly HazardItem[]): readonly HazardItem[] {
  return [...items].sort((a, b) => hazardLevelWeight(b.level) - hazardLevelWeight(a.level))
}

/**
 * その点は区域外だが、**近くが区域**のもの。
 *
 * 出所が 2 つある。**メッシュの隣接セル（250m）**と、**公式タイルで測ったすぐ近く（約 20m）**。
 * 前者は混在セルと GPS 誤差を補い（§8.3）、後者は**区域の縁**を拾う（§6.2 の追記）。
 * 同じレイヤが両方に出たら、**近い方（タイル）だけ**を残す——同じことを 2 回言わない。
 */
function neighboursOf(input: PointHazardInput): readonly HazardNeighbour[] {
  const hitLayerKeys = new Set(input.tile.map((reading) => reading.layerKey))
  const fromTile = input.tileNearby.flatMap((reading) => {
    const rank = hazardRankOfColor(reading.layerKey, reading.hex)
    const layer = getHazardLayer(reading.layerKey)
    if (rank === null || layer === undefined || hitLayerKeys.has(reading.layerKey)) return []
    return [neighbour(reading.layerKey, layer.labelJa, rank.level, 'tile')]
  })
  const seen = new Set(fromTile.map((each) => each.layerKey))
  const fromMesh = input.mesh.flatMap((reading) => {
    if (reading.sourceCode > 0 || reading.neighbourSourceCode <= 0) return []
    if (seen.has(reading.layerKey) || hitLayerKeys.has(reading.layerKey)) return []
    const rank = hazardRankOfSourceCode(reading.layerKey, reading.neighbourSourceCode)
    const layer = getHazardLayer(reading.layerKey)
    if (rank === null || layer === undefined) return []
    return [neighbour(reading.layerKey, layer.labelJa, rank.level, 'mesh')]
  })
  // 近い方（タイル）を先に。UI も AI も先頭から読む。
  return [...fromTile, ...fromMesh]
}

/** 近接 1 件（距離感の言い方はドメインが決める）。 */
function neighbour(
  layerKey: string,
  labelJa: string,
  level: HazardLevel,
  source: 'tile' | 'mesh',
): HazardNeighbour {
  return { layerKey, labelJa, level, source, proximityJa: PROXIMITY_JA[source] }
}

/**
 * 参照したレイヤの網羅性の注記（「白＝安全」と読ませない・§7.5-2）。
 *
 * **同じ文を持つレイヤは 1 行に畳む。** 畳まないと 11 レイヤぶんで 11 行になり、
 * 同じ文が並んで読み飛ばされる——**読まれない注意書きは無いのと同じ**。
 * 見出しはグループ名にする（「洪水：白い場所は…」）。
 *
 * ⚠ **この地域に区域図が無いレイヤは、全国の一般論ではなく「ここには無い」と言う。**
 * 「47 都道府県のうち 22 でしか整備されていません」は正しいが、**自分がその 25 側にいるのか**は
 * 分からない。粗いズームで図の有無を確かめられる（PR-4c の手）ので、分かったことをそのまま書く。
 */
function coverageNotesOf(
  layerKeys: readonly string[],
  uncoveredLayerKeys: readonly string[],
): readonly string[] {
  const uncovered = new Set(uncoveredLayerKeys)
  // 文 → その文を持つグループ。**同じ文は 1 行に畳む**（「ここには図が無い」も同じ扱い）。
  const grouped = new Map<string, Set<HazardGroup>>()
  const add = (note: string, group: HazardGroup): void => {
    grouped.set(note, (grouped.get(note) ?? new Set<HazardGroup>()).add(group))
  }
  for (const key of layerKeys) {
    const layer = getHazardLayer(key)
    if (layer === undefined) continue
    if (uncovered.has(key)) add(UNCOVERED_NOTE_JA, layer.group)
    else if (layer.coverageNoteJa !== null) add(layer.coverageNoteJa, layer.group)
  }
  // 「ここには図が無い」を先に出す。**いちばん具体的で、いちばん誤解を生む事実**なので。
  const ordered = [...grouped].sort(
    ([left], [right]) => Number(right === UNCOVERED_NOTE_JA) - Number(left === UNCOVERED_NOTE_JA),
  )
  return ordered.map(
    ([note, groups]) =>
      `${[...groups].map((group) => HAZARD_GROUP_LABELS_JA[group]).join('・')}：${note}`,
  )
}

/**
 * 出典（**データセットごと**に畳む）。表示は利用条件なので、答えに使ったものは必ず載せる。
 *
 * 畳む鍵は `layer.source`（＝データセット。`legendUrl` と 1:1）、出す文字は
 * `layer.attribution`（＝配信元。5 データセットが同じ 1 文になる）。粒度が違うので、
 * そのまま並べると**同じ文で URL だけ違う行**が最大 5 行できる（260828_fix_flood §11.2）。
 * だから `forJa` に**そのデータセットで答えたグループ名**を入れて返し、
 * 表示側（`SourceList`）が `labelJa` で 1 行に束ねる——文は 1 回、リンクは全部残る（案 C）。
 */
export function sourcesOf(layerKeys: readonly string[], usedNavi: boolean): readonly SourceRef[] {
  type Dataset = {
    readonly labelJa: string
    readonly url: string | null
    readonly license: string
    readonly groups: Set<HazardGroup>
  }
  const datasets = new Map<string, Dataset>()
  for (const key of layerKeys) {
    const layer = getHazardLayer(key)
    if (layer === undefined) continue
    const current = datasets.get(layer.source) ?? {
      labelJa: layer.attribution,
      url: layer.legendUrl,
      license: layer.license,
      groups: new Set<HazardGroup>(),
    }
    current.groups.add(layer.group)
    datasets.set(layer.source, current)
  }
  const refs = [...datasets.values()].map((dataset) => ({
    labelJa: dataset.labelJa,
    url: dataset.url,
    license: dataset.license,
    forJa: [...dataset.groups].map((group) => HAZARD_GROUP_LABELS_JA[group]).join('・'),
  }))
  return usedNavi ? [...refs, SUIBOU_NAVI_SOURCE] : refs
}

/** 判定に渡す形へ（レイヤ名と実単位の下限だけあればよい）。 */
function toVerdictItem(item: HazardItem, rank: HazardPointRank): VerdictItem {
  return {
    layerKey: item.layerKey,
    labelJa: item.labelJa,
    valueJa: item.valueJa,
    rankLabelJa: rank.labelJa,
    level: item.level,
    min: rank.min,
    meaningJa: item.meaningJa ?? '',
    certainty: item.certainty,
    coverage: item.coverage,
  }
}

/** メッシュで答えた行に添える注記＋隣接メッシュの注記。 */
function meshNotesOf(
  items: readonly HazardItem[],
  neighbours: readonly HazardNeighbour[],
): readonly string[] {
  const fromCells = items.flatMap((item) =>
    item.source === 'mesh' && item.coverage !== null
      ? [meshNoteJa(item.labelJa, item.coverage)]
      : [],
  )
  return [...fromCells, ...neighbours.map((each) => neighbourNoteJa(each.labelJa, each.source))]
}

/**
 * 判定の根拠に、浸水ナビの「何分後に・何日続く」を足す（§6.1）。
 * 判定そのもの（§6.2 の表）は変えない——**表は閾値の合意記録**なので、河川情報で動かさない。
 */
function withRiverReasons(verdict: HazardVerdict, rivers: readonly HazardRiver[]): HazardVerdict {
  const extra = riverReasonsJa(rivers)
  return extra.length === 0 ? verdict : { ...verdict, reasonsJa: [...verdict.reasonsJa, ...extra] }
}

/**
 * 地点のハザードを組み立てる。**この関数だけが「何が危ないか」を決める。**
 *
 * @param layerKeys 参照したレイヤ（点の答えを持ちうるもの・網羅性の注記の対象にもなる）
 */
export function pointHazard(
  input: PointHazardInput,
  layerKeys: readonly string[],
): HazardPointResponse {
  const deepestM = deepestRiver(input.rivers)
  const resolved = layerKeys.flatMap((key) => {
    const hit = resolveLayer(key, input, deepestM)
    const item = hit === null ? null : toItem(key, hit)
    return hit === null || item === null ? [] : [{ key, item, rank: hit.rank }]
  })
  const items = byDangerFirst(resolved.map((each) => each.item))
  const certainty: HazardCertainty = input.online
    ? weakestCertainty(items.map((item) => item.certainty))
    : 'unknown'
  const neighbours = neighboursOf(input)
  const code = meshCodeFromLonLat(input.lon, input.lat)
  const usedNavi = items.some((item) => item.source === 'suibou-navi')
  return {
    point: { lon: input.lon, lat: input.lat, placeJa: input.placeJa },
    mesh: { code, sizeM: MESH_SIZE_M, center: meshCenterOf(code) },
    terrain: { elevMeanM: input.elevationM },
    hazards: [...items],
    neighbours: [...neighbours],
    rivers: [...input.rivers],
    verdict: withRiverReasons(
      hazardVerdict(
        resolved.map((each) => toVerdictItem(each.item, each.rank)),
        certainty,
        neighbours,
      ),
      input.rivers,
    ),
    certainty,
    coverageNotesJa: [
      ...coverageNotesOf(layerKeys, input.uncoveredLayerKeys),
      ...meshNotesOf(items, neighbours),
    ],
    sources: [
      ...sourcesOf(
        items.map((item) => item.layerKey),
        usedNavi,
      ),
    ],
    notesJa: [...input.notesJa],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
}
