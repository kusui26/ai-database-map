/**
 * ドメイン：**敏感度**（純関数・`docs/260912_gui_chat_protocol.md` §13.4-4）。
 *
 * 重みは好みであって、正解ではない。だから「この重みならこの順」だけを出すのは不誠実で、
 * **少し振ったら順位が変わるのか**を一緒に言う。変わらなければ「頑健」、変われば「僅差」。
 *
 * ## 振り方
 *
 * 指標を 1 つずつ取り、その重みだけを **×0.8 と ×1.2** にして合計 1 に揃え直し、
 * 上位 N の**顔ぶれと並び**を base と比べる。指標数 × 2 回の決定的な計算で、乱数は使わない。
 *
 * 全部の重みを同時に動かす組み合わせ（2^M 通り）は採らない——数が増えるだけで、
 * 「どの指標に依存しているか」は 1 つずつ振ったほうがはっきり出る。
 *
 * ## 正規化はやり直さない
 *
 * 正規化は候補集合の分布だけで決まり、重みに依らない。だから振るのは重みだけでよく、
 * 同じ正規化値を使い回す（＝結果は重みの違いだけに由来する）。
 */

import type { ScoredMetric, Sensitivity } from './types'

/** 上位の既定件数。 */
export const DEFAULT_TOP_N = 5

/** 重みを振る幅（±20%）。 */
export const SENSITIVITY_FACTORS: readonly number[] = [0.8, 1.2]

export type SensitivityRow = {
  readonly grp: string
  /** 指標 key → 正規化値（大きいほど良い）。 */
  readonly normalized: Readonly<Record<string, number>>
  readonly hazardPenalty: number
}

function scoreWith(row: SensitivityRow, weights: Readonly<Record<string, number>>): number {
  const sum = Object.entries(weights).reduce(
    (total, [key, weight]) => total + (row.normalized[key] ?? 0) * weight,
    0,
  )
  return sum - row.hazardPenalty
}

/** スコア降順の grp 並び。同点は grp の辞書順で決定的にする。 */
function orderOf(
  rows: readonly SensitivityRow[],
  weights: Readonly<Record<string, number>>,
): readonly string[] {
  return [...rows]
    .map((row) => ({ grp: row.grp, score: scoreWith(row, weights) }))
    .sort((a, b) => b.score - a.score || a.grp.localeCompare(b.grp))
    .map((entry) => entry.grp)
}

/** 1 指標だけ重みを倍率で動かし、合計 1 に揃え直す。 */
function perturb(
  weights: Readonly<Record<string, number>>,
  key: string,
  factor: number,
): Readonly<Record<string, number>> {
  const moved = Object.entries(weights).map(([k, w]) => [k, k === key ? w * factor : w] as const)
  const total = moved.reduce((sum, [, w]) => sum + w, 0)
  return Object.fromEntries(moved.map(([k, w]) => [k, w / total]))
}

/** base の上位 N で隣り合う 2 駅のうち、順序が入れ替わった組。 */
function swappedPairs(
  base: readonly string[],
  other: readonly string[],
): (readonly [string, string])[] {
  const rank = new Map(other.map((grp, index) => [grp, index]))
  const pairs: (readonly [string, string])[] = []
  for (let i = 0; i + 1 < base.length; i += 1) {
    const [a, b] = [base[i] ?? '', base[i + 1] ?? '']
    if ((rank.get(a) ?? -1) > (rank.get(b) ?? -1)) pairs.push([a, b] as const)
  }
  return pairs
}

/** 重みを 1 つずつ ±20% 振って、上位 N の安定性を見る。 */
export function sensitivity(
  rows: readonly SensitivityRow[],
  metrics: readonly ScoredMetric[],
  weights: Readonly<Record<string, number>>,
  topN: number = DEFAULT_TOP_N,
): Sensitivity {
  const base = orderOf(rows, weights).slice(0, topN)
  const baseSet = new Set(base)
  const swaps = new Map<string, readonly [string, string]>()
  const entered = new Set<string>()
  const left = new Set<string>()
  for (const metric of metrics) {
    for (const factor of SENSITIVITY_FACTORS) {
      const order = orderOf(rows, perturb(weights, metric.key, factor))
      const top = order.slice(0, topN)
      for (const pair of swappedPairs(base, order)) swaps.set(pair.join('>'), pair)
      for (const grp of top) if (!baseSet.has(grp)) entered.add(grp)
      for (const grp of base) if (!top.includes(grp)) left.add(grp)
    }
  }
  const runs = metrics.length * SENSITIVITY_FACTORS.length
  const stable = swaps.size === 0 && entered.size === 0 && left.size === 0
  return {
    runs,
    stable,
    swaps: [...swaps.values()],
    enteredTop: [...entered],
    leftTop: [...left],
  }
}
