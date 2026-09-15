/**
 * ドメイン：**重みの初期値**（`docs/260912_gui_chat_protocol.md` §13.5-3）。
 *
 * 数値はスキル `station-recommendation` の表と**同じもの**にしてある。画面とエージェントで
 * 同じ質問に別の既定を出さないため——違う答えになるとしたら、それは利用者が重みを動かした
 * からであって、入口が違うからであってはならない。
 *
 * ## 重みは「正解」ではない
 *
 * ここにあるのは**話の出発点**で、押しつけるものではない。画面は必ず動かせるようにし、
 * 採った値を本文に出す（§13.4-2）。だから型も「プリセット」であって「設定」ではない。
 *
 * ## 指標の指定は「ファミリ名」または「正確な key」
 *
 * 半径・年の既定でよいものはファミリ名（`pop_gr` など）で書き、変種を選びたいものだけ
 * 正確な key で書く（`rate_covid`＝コロナ前後。`rate_yoy`＝前年比、と 2 つあるため）。
 * 解決は上の層の仕事（`build_dataset` と同じ規約）。
 */

import type { MetricDirection } from './types'

/** プリセットの 1 指標。`metric` はファミリ名か正確な key。 */
export type PresetMetric = {
  readonly metric: string
  readonly labelJa: string
  readonly direction: MetricDirection
  readonly weight: number
}

export const PRESET_IDS = ['family', 'asset', 'convenience', 'budget'] as const
export type PresetId = (typeof PRESET_IDS)[number]

export type RecommendPreset = {
  readonly id: PresetId
  readonly labelJa: string
  /** どういう人向けかを 1 行で（画面にそのまま出す）。 */
  readonly noteJa: string
  readonly metrics: readonly PresetMetric[]
}

/** 6 軸の並び。表の列順もこれに揃える。 */
const AXES = [
  { metric: 'pop_gr_pred', labelJa: '将来人口', direction: 'higher' },
  { metric: 'pop_gr', labelJa: '実績人口', direction: 'higher' },
  { metric: 'lp_gr', labelJa: '地価トレンド', direction: 'higher' },
  { metric: 'lp_med', labelJa: '地価水準', direction: 'higher' },
  { metric: 'rate_covid', labelJa: '乗降回復', direction: 'higher' },
  { metric: 'pax', labelJa: '乗降水準', direction: 'higher' },
] as const satisfies readonly Omit<PresetMetric, 'weight'>[]

/** 6 つの重みを軸の並びどおりに与えてプリセットを組む。 */
function buildMetrics(
  weights: readonly [number, number, number, number, number, number],
  landPriceDirection: MetricDirection,
): readonly PresetMetric[] {
  return AXES.map((axis, index) => ({
    metric: axis.metric,
    labelJa: axis.labelJa,
    direction: axis.metric === 'lp_med' ? landPriceDirection : axis.direction,
    weight: weights[index] ?? 0,
  }))
}

/**
 * 既定の 4 つ。`family` / `asset` / `convenience` はスキルの表そのまま。
 * `budget` はスキルが「予算重視」で実走している振り替え——**地価水準を「安いほど良い」に
 * 向け直し**、その分を地価トレンドと将来人口から回す。
 */
export const RECOMMEND_PRESETS: Readonly<Record<PresetId, RecommendPreset>> = {
  family: {
    id: 'family',
    labelJa: 'ファミリー（持続性）',
    noteJa: '将来も人が住み続けるか、を重く見ます。地価水準は見ません。',
    metrics: buildMetrics([0.3, 0.2, 0.2, 0.0, 0.15, 0.15], 'higher'),
  },
  asset: {
    id: 'asset',
    labelJa: '資産性重視',
    noteJa: '地価が上がっているか、水準が高いかを重く見ます。',
    metrics: buildMetrics([0.2, 0.1, 0.25, 0.2, 0.1, 0.15], 'higher'),
  },
  convenience: {
    id: 'convenience',
    labelJa: '利便性重視',
    noteJa: '乗降客数の水準と回復を重く見ます。地価水準は見ません。',
    metrics: buildMetrics([0.2, 0.15, 0.15, 0.0, 0.2, 0.3], 'higher'),
  },
  budget: {
    id: 'budget',
    labelJa: '予算重視',
    noteJa: '地価水準を「安いほど良い」として見ます。',
    metrics: buildMetrics([0.25, 0.2, 0.1, 0.15, 0.15, 0.15], 'lower'),
  },
}

/** 重みの合計（丸め誤差を見るのに使う。プリセットはすべて 1 になる）。 */
export function weightSum(preset: RecommendPreset): number {
  return preset.metrics.reduce((sum, metric) => sum + metric.weight, 0)
}
