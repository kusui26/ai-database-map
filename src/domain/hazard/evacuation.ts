/**
 * ドメイン：避難先の選び方と言い方（`docs/260824_flood.md` §8.5・§11 リスク 10）。
 *
 * ここは**純関数だけ**。取得は `lib/hazard/evacuation-source` が担う。
 *
 * ## このモジュールが守っている 3 つのこと
 *
 * 1. **災害種別で必ず絞る。** 洪水に対応していない避難場所へ誘導したら本末転倒で、
 *    §11 のリスク 10（人命）そのものになる。絞り込みは「国土地理院のレイヤを選ぶこと」
 *    と「`disasterN` が立っていること」の**二重**で行う（片方が壊れても素通りしない）
 * 2. **浸水想定区域の中にある避難場所を、黙って上位に出さない。** 指定はされていても、
 *    想定最大規模では浸水しうる。外にあるものを先に出し、中にあるものは印を付ける
 * 3. **「開いている」とは絶対に言わない。** 国土地理院が配っているのは**指定の一覧**であって
 *    開設状況ではない。開設するのは市町村で、このアプリは知り得ない（§3.6・§7.4 と同じ立場）
 */

import { distanceM } from '@/shared/geo'
import type { CellCertainty } from '@/shared/hazard-mesh'
import {
  EVACUATION_SITE_KIND_JA,
  evacuationDisasterLabelJa,
  type EvacuationDisasterKey,
} from '@/shared/evacuation'

/** 上位いくつ返すか（既定）。§6.5 の表が「上位 5 件」。 */
export const EVACUATION_TOP_DEFAULT = 5

/** 探す半径（既定・メートル）。徒歩で逃げられる距離の目安。 */
export const EVACUATION_RADIUS_DEFAULT_M = 5_000

/** 八方位（北から時計回り）。**16 方位にしない**——口頭で伝わる粒度に留める。 */
const BEARINGS_JA = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const

const DEGREES_PER_TURN = 360
const BEARING_STEP_DEG = DEGREES_PER_TURN / BEARINGS_JA.length

/**
 * 2 点の方位（八方位）。**距離だけでは伝わらない**——「1.2km」と言われても
 * どちらへ行けばよいか分からない。地図が見られない状況でも動ける情報にする。
 */
export function bearingJa(
  from: { readonly lon: number; readonly lat: number },
  to: { readonly lon: number; readonly lat: number },
): string {
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const deltaLon = toRad(to.lon - from.lon)
  const fromLat = toRad(from.lat)
  const toLat = toRad(to.lat)
  const y = Math.sin(deltaLon) * Math.cos(toLat)
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon)
  const degrees = (Math.atan2(y, x) * 180) / Math.PI
  const normalised = (degrees + DEGREES_PER_TURN) % DEGREES_PER_TURN
  const index = Math.round(normalised / BEARING_STEP_DEG) % BEARINGS_JA.length
  return BEARINGS_JA[index] ?? '北'
}

/** 距離の言い方（1km 未満は m・以上は小数 1 桁の km）。 */
export function distanceJa(metres: number): string {
  const METRES_PER_KM = 1_000
  const ROUND_TO_M = 10
  if (metres < METRES_PER_KM) return `約${Math.round(metres / ROUND_TO_M) * ROUND_TO_M}m`
  return `約${(metres / METRES_PER_KM).toFixed(1)}km`
}

/** 並べ替える前の 1 件（取得層が組み立てて渡す）。 */
export type EvacuationCandidate = {
  readonly nameJa: string
  readonly addressJa: string
  readonly lon: number
  readonly lat: number
  readonly remarksJa: string | null
  /** その場所が指定されている災害種別（表示名）。 */
  readonly disastersJa: readonly string[]
  /** **その災害の**想定区域との重なり（`hazardArea` が意味づけ済みの形で持つ）。 */
  readonly hazardArea: HazardArea
  /** 平均標高（m・分からなければ null）。 */
  readonly elevationM: number | null
}

/** 想定区域との重なり（`null`＝判定できない）。 */
export type HazardAreaCertainty = CellCertainty | null

/** 重なりを何から読んだか。無ければ（判定できなければ）`null`。 */
export type HazardAreaSource = 'tile' | 'mesh'

/**
 * 避難場所と**その災害の**想定区域の重なり。
 *
 * ⚠ **真偽値にしてはいけない。** 言い切れるのは両端だけである（§5.9）。
 *
 * | | メッシュ（250m） | 公式タイル（画素 ≒ 2m） |
 * |---|---|---|
 * | `outside` | セルに一切かからない | その点は塗られていない |
 * | `partial` | セルの**一部**が区域 | 点は外だが**すぐ近く**が区域 |
 * | `inside`  | セル**全域**が区域 | **その点が区域内** |
 * | `null`    | メッシュが無い | タイルが無い（未整備かもしれない）|
 *
 * 同じ `'inside'` でも、メッシュは「250m 四方のどこか」までしか言えず、タイルは
 * **その点そのもの**を指す。だから `source` を捨てずに持ち歩き、言い方を変える。
 *
 * 実測（新宿駅・洪水）で、これを真偽値にすると**標高 25〜30m の避難場所まで
 * 「区域の中」**と言い切ってしまった。
 */
export type HazardArea = {
  readonly certainty: HazardAreaCertainty
  /** どこから読んだか（判定できなければ null）。 */
  readonly source: HazardAreaSource | null
  /** 当たった区域の名前（「土砂災害警戒区域（イエローゾーン）」など）。分からなければ null。 */
  readonly detailJa: string | null
}

/** 判定できなかったときの値。 */
export const HAZARD_AREA_UNKNOWN: HazardArea = {
  certainty: null,
  source: null,
  detailJa: null,
}

/** 並べ替えたあとの 1 件（距離と方角が付く）。 */
export type EvacuationSite = EvacuationCandidate & {
  readonly distanceM: number
  readonly bearingJa: string
  readonly distanceJa: string
}

/** 起点からの距離と方角を付ける。 */
function toSite(
  origin: { readonly lon: number; readonly lat: number },
  candidate: EvacuationCandidate,
): EvacuationSite {
  const metres = Math.round(distanceM(origin.lon, origin.lat, candidate.lon, candidate.lat))
  return {
    ...candidate,
    distanceM: metres,
    bearingJa: bearingJa(origin, candidate),
    distanceJa: distanceJa(metres),
  }
}

/**
 * 並べる順の重み。**確実に区域の外にあるものが先**（§11 リスク 10 の「浸水域内は降格表示」）。
 *
 * 順は「外 → 判定できない → 一部かかる → 全域が区域内」。
 * **判定できない（`null`）を「一部かかる」より先に置く**のは、後者には
 * *区域に触れているという証拠がある*ぶん、確実に下げてよいためである。
 * 分からないものは、根拠なく上げも下げもしない（`'outside'` の下・`'partial'` の上）。
 */
const CERTAINTY_ORDER: readonly HazardAreaCertainty[] = ['outside', null, 'partial', 'inside']

function outsideRank(certainty: HazardAreaCertainty): number {
  const index = CERTAINTY_ORDER.indexOf(certainty)
  return index === -1 ? CERTAINTY_ORDER.length : index
}

/**
 * 候補 → 表示順の上位 N 件。
 *
 * 距離だけで並べない。指定緊急避難場所は「その災害で使える」ことになっているが、
 * **想定最大規模では浸水しうる**場所も含まれる（指定の基準と想定の規模が違う）。
 * だから「区域の外 → 分からない → 区域の中」の順にしてから、距離で並べる。
 */
export function rankEvacuationSites(
  origin: { readonly lon: number; readonly lat: number },
  candidates: readonly EvacuationCandidate[],
  top: number = EVACUATION_TOP_DEFAULT,
): readonly EvacuationSite[] {
  return candidates
    .map((candidate) => toSite(origin, candidate))
    .sort(
      (a, b) =>
        outsideRank(a.hazardArea.certainty) - outsideRank(b.hazardArea.certainty) ||
        a.distanceM - b.distanceM,
    )
    .slice(0, top)
}

// --- 文言（**ここだけが言い方の真実**） -----------------------------------

/**
 * この一覧に含まれていないこと。**必ず全部そのまま表示する。**
 * 1 行でも落ちると、落ちた行のぶんだけ利用者が誤解する余地が増える。
 */
export const EVACUATION_LIMITATIONS_JA: readonly string[] = [
  `ここに出るのは市町村が指定した${EVACUATION_SITE_KIND_JA}の一覧です。**いま開設されているかは分かりません**——開設するのは市町村なので、必ず市町村の避難情報を確認してください。`,
  '距離は**直線距離**です。道路が冠水・崩落していて、実際には近づけないことがあります。',
  `命を守るために緊急的に逃げ込む場所であり、一定期間滞在する「指定避難所」とは異なります。`,
  '「想定区域の外」は、聞かれた災害の想定区域を 250m メッシュで見た**目安**です。指定されている場所でも、想定最大規模では浸水することがあります。',
  '洪水の指定は**対象の川が決まっていることがあります**（各件の備考を確認してください）。',
]

/**
 * 1 文の結論。**「ここへ逃げてください」とは書かない**（指示ではなく情報提供）。
 *
 * ⚠ **先頭を「最寄り」と呼ばない。** 並びは「浸水想定区域の外が先」なので、
 * 先頭が最も近いとは限らない（実測：亀有駅では 3.5km の場所より 4.5km の場所が先に来る
 * ——手前の 3.5km は区域の中にあるため）。**距離と「外か中か」を混ぜた一語にしない。**
 */
export function evacuationHeadlineJa(
  placeJa: string,
  disaster: EvacuationDisasterKey,
  sites: readonly EvacuationSite[],
  radiusM: number,
): string {
  const forJa = evacuationDisasterLabelJa(disaster)
  const head = sites[0]
  if (head === undefined) {
    return `${placeJa}から${distanceJa(radiusM)}以内に、${forJa}に対応した${EVACUATION_SITE_KIND_JA}は見つかりませんでした。市町村の避難情報を確認してください。`
  }
  const where = `${head.bearingJa}へ${head.distanceJa}の「${head.nameJa}」`
  const lead = `${placeJa}の近くで${forJa}に対応した${EVACUATION_SITE_KIND_JA}`
  if (head.hazardArea.certainty === 'outside') {
    return `${lead}のうち、**${forJa}の想定区域にかからない**もので、いちばん近いのは${where}です。`
  }
  if (head.hazardArea.certainty === null) {
    return `${lead}のうち、いちばん近いのは${where}です（${forJa}の想定区域との重なりは判定できませんでした）。`
  }
  return `${lead}は${where}が最寄りですが、**この範囲では${forJa}の想定区域にかからないものが見つかりませんでした**。市町村の避難情報を確認してください。`
}

// --- 重なりの読み取り（**両端だけを言い切る**・§5.9・§6.3） -----------------

/** 250m メッシュの 1 レイヤぶん（`domain/hazard/point` の `MeshReading` の部分集合）。 */
export type AreaMeshReading = {
  readonly coverage: number
}

/**
 * メッシュから重なりを読む。**被覆率の両端だけが厳密**で、間は `'partial'`。
 * 1 レイヤも無ければ「判定できない」——読めなかったことを「区域の外」にしない。
 */
export function hazardAreaFromMesh(readings: readonly AreaMeshReading[]): HazardArea {
  if (readings.length === 0) return HAZARD_AREA_UNKNOWN
  const certainty = readings.every((reading) => reading.coverage === 0)
    ? 'outside'
    : readings.some((reading) => reading.coverage === 1)
      ? 'inside'
      : 'partial'
  return { certainty, source: 'mesh', detailJa: null }
}

/** 公式タイルの 1 レイヤぶん（画素の色。読み取りは `lib/hazard/readings` が行う）。 */
export type AreaTileReading = {
  readonly layerKey: string
  /** タイルが届いて画素を読めたか。**404 を「区域外」にしない**ための旗。 */
  readonly reached: boolean
  /** その点の色（塗られていなければ null）。 */
  readonly hexAtPoint: string | null
  /** 周囲を確かめたときに見つかった色（見つからなければ null）。 */
  readonly hexNearby: string | null
}

/**
 * 公式タイルの画素から重なりを読む（§6.3 の優先順位 ②）。
 *
 * タイルは原典の解像度（z16 で 1 画素 ≒ 2m）なので、**塗られていればその点が区域内**と
 * 言い切れる。メッシュの `'inside'`（250m 四方のどこか）より強い主張である。
 *
 * ⚠ **境界の画素は色が混ざる。** 実測（土石流警戒区域・熱海）で、塗りは `#E6C832` なのに
 * 縁の画素は `#E6C732`（α225）だった。色は**完全一致だけ**を採る規約（§10.2 ③）なので、
 * 縁に立つと「該当なし」になってしまう。そこで**周囲も確かめ**、点は外でも近くが区域なら
 * `'partial'`（＝区域のすぐ近く）とする。メッシュ側の隣接セル確認（§8.3）と同じ発想である。
 */
export function hazardAreaFromTiles(
  readings: readonly AreaTileReading[],
  rankLabelOf: (layerKey: string, hex: string) => string | null,
): HazardArea {
  const reached = readings.filter((reading) => reading.reached)
  if (reached.length === 0) return HAZARD_AREA_UNKNOWN
  const hit = reached.find((reading) => reading.hexAtPoint !== null)
  if (hit !== undefined) {
    return {
      certainty: 'inside',
      source: 'tile',
      detailJa: rankLabelOf(hit.layerKey, hit.hexAtPoint ?? ''),
    }
  }
  const near = reached.find((reading) => reading.hexNearby !== null)
  if (near !== undefined) {
    return {
      certainty: 'partial',
      source: 'tile',
      detailJa: rankLabelOf(near.layerKey, near.hexNearby ?? ''),
    }
  }
  return { certainty: 'outside', source: 'tile', detailJa: null }
}

/**
 * より強い方の答えを採る（§6.3 の優先順位）。
 * **タイル ＞ メッシュ**——タイルは点そのもの、メッシュは 250m の区間だから。
 * タイルが判定できなかったときだけメッシュに落ちる。
 */
export function strongerHazardArea(tile: HazardArea, mesh: HazardArea): HazardArea {
  return tile.certainty === null ? mesh : tile
}

// --- 文言 -----------------------------------------------------------------

/**
 * 重なり方の言い方。**出所で言い方を変える**——同じ `'inside'` でも、
 * タイルは「その点が区域内」、メッシュは「250m 四方のどこか」までしか言えない（§5.9）。
 */
const AREA_LABELS_JA: Readonly<
  Record<HazardAreaSource, Readonly<Record<NonNullable<HazardAreaCertainty>, string>>>
> = {
  tile: {
    outside: '想定区域にかからない',
    partial: '区域のすぐ近く',
    inside: '想定区域の中',
  },
  mesh: {
    outside: '想定区域にかからない',
    partial: '一部が想定区域（250mメッシュ）',
    inside: '想定区域の中（250mメッシュ）',
  },
}

/** その重なり方の見せ方（UI のバッジ・AI の言い方の土台）。 */
export function hazardAreaLabelJa(area: HazardArea): string {
  if (area.certainty === null || area.source === null) return '想定区域との重なりは不明'
  return AREA_LABELS_JA[area.source][area.certainty]
}

/** 一覧に添える注記（区域にかかるもの・判定できなかったものがあるときだけ増える）。 */
export function evacuationNotesJa(
  disaster: EvacuationDisasterKey,
  sites: readonly EvacuationSite[],
): readonly string[] {
  const forJa = evacuationDisasterLabelJa(disaster)
  const named = (list: readonly EvacuationSite[]): string =>
    list.map((site) => site.nameJa).join('・')
  const withCertainty = (want: HazardAreaCertainty): readonly EvacuationSite[] =>
    sites.filter((site) => site.hazardArea.certainty === want)
  const inside = withCertainty('inside')
  const partial = withCertainty('partial')
  const unknown = withCertainty(null)
  return [
    ...(inside.length === 0
      ? []
      : [
          `${inside.length} 件は**${forJa}の想定区域の中**にあります（${named(inside)}）。指定はされていますが、想定最大規模では使えないことがあります。`,
        ]),
    ...(partial.length === 0
      ? []
      : [
          `${partial.length} 件は${forJa}の想定区域に**接しています**（${named(partial)}）。その場所そのものが区域内とは限りませんが、地図の色で確かめてください。`,
        ]),
    ...(unknown.length === 0
      ? []
      : [
          `${unknown.length} 件は想定区域との重なりを**判定できませんでした**（${named(unknown)}）。この地域に${forJa}の区域図が無いか、取得できませんでした——**区域が無いという意味ではありません**。`,
        ]),
  ]
}
