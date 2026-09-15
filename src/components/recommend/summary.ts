/**
 * 表と脚注に出す**数の言い方**（純関数）。
 *
 * 文章の大半はサーバが作る（`methodJa` / `verdictJa` / `reasonJa` …）。ここに残るのは
 * 画面の都合で組み立てる短い断片だけ——件数の並べ方と、帯の目盛り。
 * 純関数にしてあるのは、境界（0 件・全除外・負のスコア）をテストで固定するため。
 */

import type { RecommendResponse } from '@/shared/api'

/** 除外の内訳に出す順と呼び名（件数 0 の種別は出さない）。 */
const EXCLUSION_LABELS_JA: readonly (readonly [
  keyof RecommendResponse['excludedCounts'],
  string,
])[] = [
  ['hazard', '災害'],
  ['missing', '欠損'],
  ['flagged', '⚠'],
]

/** 「候補 18 駅 → 順位 15 駅」。**候補の数を必ず先に言う**（候補が変われば順位も変わるため）。 */
export function countsJa(counts: {
  readonly candidateCount: number
  readonly rankedCount: number
}): string {
  return `候補 ${counts.candidateCount} 駅 → 順位 ${counts.rankedCount} 駅`
}

/** 「除外 3 駅（災害 3）」。1 駅も外していなければ `null`。 */
export function exclusionsJa(counts: RecommendResponse['excludedCounts']): string | null {
  if (counts.total === 0) return null
  const parts = EXCLUSION_LABELS_JA.flatMap(([key, labelJa]) =>
    counts[key] > 0 ? [`${labelJa} ${counts[key]}`] : [],
  )
  return `除外 ${counts.total} 駅（${parts.join('・')}）`
}

/** 重みの割合（サーバが返した合計 1 の値を % に）。 */
export function percentJa(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** 合成スコア。小数 3 桁で、桁を揃えて読めるようにする。 */
export function scoreJa(score: number): string {
  return score.toFixed(3)
}

/**
 * 内訳の帯の目盛り（＝表示行の最大スコア）。
 *
 * z-score はスコアが負になりうる。そのときは帯を描かない（`0` を返す）——
 * 負の長さは描けないし、無理に描くと**比率を偽る**ことになる。
 */
export function barScale(rows: readonly { readonly score: number }[]): number {
  return Math.max(0, ...rows.map((row) => row.score))
}

/** 帯 1 本ぶんの幅（%）。負の寄与は 0 にする（描けるのは正の寄与だけ）。 */
export function barWidth(value: number, scale: number): number {
  return scale <= 0 ? 0 : Math.max(0, (value / scale) * 100)
}
