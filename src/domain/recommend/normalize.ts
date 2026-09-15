/**
 * ドメイン：**正規化**（純関数・`docs/260912_gui_chat_protocol.md` §13.4-1）。
 *
 * 単位の違う値を素で足すのは誤り。合成の前に必ずここを通す。
 * 3 つの方法を持ち、**1 回の合成では 1 つだけ**を使う（混ぜると意味が消える）。
 *
 * | 方法 | 出る値 | 向いている場面 |
 * |---|---|---|
 * | `percentile` | 0〜1（エリア内の相対位置） | 画面。「上位 12%」と言えるので説明しやすく、外れ値に強い |
 * | `minmax` | 0〜1（最小〜最大の線形） | 差の大きさをそのまま出したいとき。外れ値に弱い |
 * | `zscore` | 平均 0・標準偏差 1 | 分布の裾を見たいとき。0〜1 に収まらない |
 *
 * **どの方法でも「大きいほど良い」に揃える**（`direction: 'lower'` は内部で反転する）。
 * こうしておけば合成側は向きを知らなくてよい。
 *
 * ## 効かなかったことを黙らない
 *
 * 全駅が同値なら差は付かない。そこで 0.5 を返すのは「引き分け」として正しいが、
 * **そう扱ったことを呼び出し側に返す**（`DegenerateMetric`）。黙って 0.5 にすると、
 * 重みを掛けた分だけスコアが動いて、効いていない指標が効いたように見える。
 */

import type { MetricDirection, NormalizeMethod } from './types'

/** 差が付かないときに全員へ返す値（＝引き分け）。 */
const TIE_SCORE = 0.5

/** パーセンタイルと min-max は 2 駅以上ないと意味がない。 */
const MIN_SAMPLES = 2

export type NormalizeOutcome = {
  /** 入力と同じ並びの正規化値（大きいほど良い）。 */
  readonly scores: readonly number[]
  /** 差が付かなかった理由（付いたときは null）。 */
  readonly degenerate: 'no-spread' | 'too-few' | null
}

/** 昇順に並べた値の中での順位（同値は平均順位）を 0〜1 に写す。 */
function percentileScores(values: readonly number[]): readonly number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const last = sorted.length - 1
  return values.map((value) => {
    const first = sorted.indexOf(value)
    const final = sorted.lastIndexOf(value)
    return (first + final) / 2 / last
  })
}

function minMaxScores(values: readonly number[], min: number, max: number): readonly number[] {
  const span = max - min
  return values.map((value) => (value - min) / span)
}

function zScores(values: readonly number[], mean: number, sd: number): readonly number[] {
  return values.map((value) => (value - mean) / sd)
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 母集団の標準偏差（標本ではない——候補集合そのものを見ているので）。 */
function sdOf(values: readonly number[], mean: number): number {
  const variance = meanOf(values.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

/** 方法ごとの素の正規化（向きはまだ適用しない）。 */
function rawScores(values: readonly number[], method: NormalizeMethod): NormalizeOutcome {
  if (values.length < MIN_SAMPLES) {
    return { scores: values.map(() => TIE_SCORE), degenerate: 'too-few' }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return { scores: values.map(() => TIE_SCORE), degenerate: 'no-spread' }
  if (method === 'percentile') return { scores: percentileScores(values), degenerate: null }
  if (method === 'minmax') return { scores: minMaxScores(values, min, max), degenerate: null }
  const mean = meanOf(values)
  return { scores: zScores(values, mean, sdOf(values, mean)), degenerate: null }
}

/** 「低いほど良い」を「大きいほど良い」に反転する。0〜1 の方法は 1 から引く。 */
function flip(scores: readonly number[], method: NormalizeMethod): readonly number[] {
  return method === 'zscore' ? scores.map((s) => -s) : scores.map((s) => 1 - s)
}

/**
 * 値の並びを正規化する。返る値は**常に「大きいほど良い」**。
 * 入力の並び順は保つ（呼び出し側が駅と対応づけられるように）。
 */
export function normalize(
  values: readonly number[],
  method: NormalizeMethod,
  direction: MetricDirection,
): NormalizeOutcome {
  const raw = rawScores(values, method)
  if (direction === 'higher' || raw.degenerate !== null) return raw
  return { scores: flip(raw.scores, method), degenerate: null }
}
