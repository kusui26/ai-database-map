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
import type { HazardNeighbour, HazardPointResponse, HazardRiver } from '@/shared/api'
import { MESH_SIZE_M, meshCenterOf, meshCodeFromLonLat } from '@/shared/mesh'
import { HAZARD_GROUP_LABELS_JA, hazardLevelWeight, type HazardGroup } from '@/shared/constants'
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
  valuePhraseJa,
  weakestCertainty,
} from './wording'
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

/** 中心セルは区域外だが、**隣の 250m メッシュ**が区域のもの。 */
function neighboursOf(input: PointHazardInput): readonly HazardNeighbour[] {
  return input.mesh.flatMap((reading) => {
    if (reading.sourceCode > 0 || reading.neighbourSourceCode <= 0) return []
    const rank = hazardRankOfSourceCode(reading.layerKey, reading.neighbourSourceCode)
    const layer = getHazardLayer(reading.layerKey)
    if (rank === null || layer === undefined) return []
    return [{ layerKey: reading.layerKey, labelJa: layer.labelJa, level: rank.level }]
  })
}

/**
 * 参照したレイヤの網羅性の注記（「白＝安全」と読ませない・§7.5-2）。
 *
 * **同じ文を持つレイヤは 1 行に畳む。** 畳まないと 11 レイヤぶんで 11 行になり、
 * 同じ文が並んで読み飛ばされる——**読まれない注意書きは無いのと同じ**。
 * 見出しはグループ名にする（「洪水：白い場所は…」）。
 */
function coverageNotesOf(layerKeys: readonly string[]): readonly string[] {
  const grouped = new Map<string, Set<HazardGroup>>()
  for (const key of layerKeys) {
    const layer = getHazardLayer(key)
    if (layer?.coverageNoteJa == null) continue
    const groups = grouped.get(layer.coverageNoteJa) ?? new Set<HazardGroup>()
    grouped.set(layer.coverageNoteJa, groups.add(layer.group))
  }
  return [...grouped].map(
    ([note, groups]) =>
      `${[...groups].map((group) => HAZARD_GROUP_LABELS_JA[group]).join('・')}：${note}`,
  )
}

/** 出典（重複を畳む）。表示は利用条件なので、答えに使ったものは必ず載せる。 */
function sourcesOf(layerKeys: readonly string[], usedNavi: boolean): readonly SourceRef[] {
  const seen = new Set<string>()
  const refs = layerKeys.flatMap((key) => {
    const layer = getHazardLayer(key)
    if (layer === undefined || seen.has(layer.source)) return []
    seen.add(layer.source)
    return [{ labelJa: layer.attribution, url: layer.legendUrl, license: layer.license }]
  })
  if (!usedNavi) return refs
  return [
    ...refs,
    {
      labelJa: '国土地理院 地点別浸水シミュレーション検索システム（浸水ナビ）',
      url: 'https://suiboumap.gsi.go.jp/',
      license: '国土交通省 利用規約',
    },
  ]
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
  return [...fromCells, ...neighbours.map((neighbour) => neighbourNoteJa(neighbour.labelJa))]
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
    verdict: hazardVerdict(
      resolved.map((each) => toVerdictItem(each.item, each.rank)),
      certainty,
    ),
    certainty,
    coverageNotesJa: [...coverageNotesOf(layerKeys), ...meshNotesOf(items, neighbours)],
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
