/**
 * ドメイン：**脱出方向**——いちばん近い「区域の外」はどちらへ何 m か（`docs/260824_flood.md` §8.6）。
 *
 * 純関数だけ。格子の読み取りは `lib/hazard/escape-source` が渡す。
 *
 * ## なぜ避難先の一覧と別に要るのか
 *
 * 指定緊急避難場所は「そこへ行け」という点の情報だが、**開いているとは限らず、
 * 数 km 先のこともある**（実測：亀有駅の洪水は 4.5km 先）。それとは別に
 * 「**どちらへ何 m 動けば、そもそも区域の外に出られるか**」は、配布済みの 250m メッシュだけで
 * 答えられ、**オフラインでも動く**。避難先の一覧を補う情報として持つ。
 *
 * ## 言い方の境界（ここが最重要）
 *
 * これは**経路案内ではない**。出すのは「方向と直線距離」までで、道路の冠水・夜間・
 * 増水の速さは一切見ていない。**「そちらへ移動してください」とは書かない**——
 * 浸水が始まっている場面では、動かずに上階へ行く方が安全なことがある（§6.2 の垂直避難）。
 * だから文言は必ず「参考として」「移動できるとは限りません」を含める（§0.4・§7.5-5）。
 *
 * ## 探し方
 *
 * 中心から**チェビシェフ距離 r = 1, 2, 3 …** の輪を順に見て、区域外のセルを探す。
 * 最初に見つかった輪 `r0` で止めない——**輪の角にあるセルは、次の輪の真横より遠い**ためで、
 * `r0 × 2` まで見てから、実距離（メートル）が最小のものを採る。
 * セルは正方形ではない（緯度方向 約231m・経度方向 約281m）ので、
 * 輪の番号ではなく**必ず実距離で比べる**。
 */

import { distanceM } from '@/shared/geo'
import { meshCenterOfIndices, type LonLat, type MeshIndices } from '@/shared/mesh'
import { bearingJa, distanceJa } from './evacuation'

/** 1 セルの読み取り結果。**「区域の外」と「分からない」を混ぜない**（§7.5-1）。 */
export type EscapeCell =
  /** その災害の区域（メッシュが「かかる」と言っている）。 */
  | 'inside'
  /** 区域の外（被覆率 0 ＝ 厳密・§5.9）。 */
  | 'outside'
  /** タイルが無い・読めない。**外とは言わない**。 */
  | 'unknown'

/** 格子の読み取り（`lib` が用意する。**同期**にするために、必要なタイルは先に載せておく）。 */
export type EscapeProbe = (indices: MeshIndices) => EscapeCell

/** 見つかった脱出先。 */
export type EscapeTarget = {
  readonly indices: MeshIndices
  /** そのセルの中心（地図に印を出せる）。 */
  readonly centre: LonLat
  readonly distanceM: number
  readonly distanceJa: string
  readonly bearingJa: string
}

export type EscapeSearchResult = {
  readonly target: EscapeTarget | null
  /** 探した範囲に「読めなかったセル」があったか（範囲を広げる判断に使う）。 */
  readonly sawUnknown: boolean
  /** 実際に見た輪の数（セル単位の半径）。 */
  readonly searchedRadiusCells: number
}

/**
 * 最初に見つかった輪 `r0` から、**どこまで見れば実距離の最小が確定するか**の倍率。
 *
 * 輪 `r` のセルの実距離は「`r` セルぶん」から「`r√2` セルぶん」まで幅があり、
 * さらにセルが正方形でない（約 231m × 281m ＝ 1.22 倍）。
 * `√2 × 1.22 ≒ 1.73` なので、**2 倍まで見れば必ず足りる**。
 */
const CONFIRM_FACTOR = 2

/** チェビシェフ距離 `r` の輪（重複なし）。 */
function ringOf(centre: MeshIndices, r: number): readonly MeshIndices[] {
  const cells: MeshIndices[] = []
  for (let d = -r; d <= r; d += 1) {
    cells.push({ latIndex: centre.latIndex + r, lonIndex: centre.lonIndex + d })
    cells.push({ latIndex: centre.latIndex - r, lonIndex: centre.lonIndex + d })
  }
  for (let d = -r + 1; d <= r - 1; d += 1) {
    cells.push({ latIndex: centre.latIndex + d, lonIndex: centre.lonIndex + r })
    cells.push({ latIndex: centre.latIndex + d, lonIndex: centre.lonIndex - r })
  }
  return cells
}

/** 起点から見た 1 セルを、脱出先の形にする。 */
function toTarget(origin: LonLat, indices: MeshIndices): EscapeTarget {
  const centre = meshCenterOfIndices(indices)
  const metres = Math.round(distanceM(origin.lon, origin.lat, centre.lon, centre.lat))
  return {
    indices,
    centre,
    distanceM: metres,
    distanceJa: distanceJa(metres),
    bearingJa: bearingJa(origin, centre),
  }
}

/**
 * いちばん近い「区域の外」のセルを探す。
 *
 * **見つからなかったことを「無い」と読ませない**——`sawUnknown` が真なら、
 * 読めていないセルがあっただけかもしれない。呼び出し側が範囲を広げるか、注記にする。
 */
export function nearestOutsideCell(
  origin: LonLat,
  start: MeshIndices,
  probe: EscapeProbe,
  maxRadiusCells: number,
): EscapeSearchResult {
  let best: EscapeTarget | null = null
  let sawUnknown = false
  let limit = maxRadiusCells
  let radius = 0
  for (let r = 1; r <= limit; r += 1) {
    radius = r
    for (const indices of ringOf(start, r)) {
      const cell = probe(indices)
      if (cell === 'unknown') sawUnknown = true
      if (cell !== 'outside') continue
      const candidate = toTarget(origin, indices)
      if (best === null || candidate.distanceM < best.distanceM) best = candidate
    }
    // 最初に見つかった輪から `CONFIRM_FACTOR` 倍まで見れば、実距離の最小が確定する。
    if (best !== null) limit = Math.min(maxRadiusCells, r * CONFIRM_FACTOR)
  }
  return { target: best, sawUnknown, searchedRadiusCells: radius }
}

// --- 文言（**「移動してください」とは書かない**） ---------------------------

/**
 * この答えに含まれていないこと。**必ず全部そのまま表示する。**
 * 1 行でも落ちると、方向と距離だけが独り歩きする。
 */
export const ESCAPE_LIMITATIONS_JA: readonly string[] = [
  '**直線距離と方角だけ**で、道路や地形は見ていません。冠水・崩落で近づけないことがあります。',
  '**移動する方が安全とは限りません。** 浸水が始まっているときは、無理に動かず建物の上階へ移る方が安全なことがあります。',
  '250m メッシュで測った**目安**です（前後 250m ほどの幅があります）。',
  'その先が**別の災害の区域**であることもあります。避難の判断は、市町村の避難情報に従ってください。',
]

/** 1 文の結論。**方向は言うが、行けとは言わない。** */
export function escapeHeadlineJa(
  placeJa: string,
  areaLabelJa: string,
  target: EscapeTarget | null,
  searchedM: number,
): string {
  if (target === null) {
    return `${placeJa}から${distanceJa(searchedM)}以内には、${areaLabelJa}の外が見つかりませんでした。市町村の避難情報を確認してください。`
  }
  return `${placeJa}から${areaLabelJa}の外へは、**${target.bearingJa}へ${target.distanceJa}**がいちばん近い向きです（参考情報です）。`
}

/**
 * そもそも答えられないときの 1 文（メッシュを持たない災害・読めなかった区画）。
 * **「区域の外」と言わない**——判定していないだけである。
 */
export function escapeUnavailableJa(placeJa: string, areaLabelJa: string, reasonJa: string): string {
  return `${placeJa}について、${areaLabelJa}の外の向きは出せませんでした（${reasonJa}）。`
}

/** 起点がすでに区域の外だったときの 1 文。**「安全」とは言わない。** */
export function outsideAlreadyJa(placeJa: string, areaLabelJa: string): string {
  return `${placeJa}は${areaLabelJa}の外です（安全という意味ではありません）。`
}
