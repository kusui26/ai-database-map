/**
 * ドメイン：**既定のレシピ**——重みの初期値と、災害の減点表
 * （`docs/260912_gui_chat_protocol.md` §13.5-3・§13.4-3）。
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

import type { HazardLevel } from '@/shared/constants'
import { recommendPresetIdSchema, type HazardPenaltyId } from '@/shared/recommend'
import type { MetricDirection } from './types'

/** プリセットの 1 指標。`metric` はファミリ名か正確な key。 */
export type PresetMetric = {
  readonly metric: string
  readonly labelJa: string
  readonly direction: MetricDirection
  readonly weight: number
  /**
   * 増減率を**何年ぶんの変化で見るか**（`year - yearBase`）。
   *
   * ファミリ名だけでは足りない。将来人口は 2025〜2070 年の 10 通り、地価トレンドは
   * 1〜15 年の 5 通りがあり、「いちばん新しい」で選ぶと**将来人口は最も遠い 2070 年、
   * 地価は最も短い 1 年**が選ばれる——どちらも住まい探しの問いに対しては的外れになる。
   * 年そのものではなく**期間**で書くので、データが 1 年進んでも意味が保たれる。
   */
  readonly spanYears?: number
}

export const PRESET_IDS = recommendPresetIdSchema.options
export type PresetId = (typeof PRESET_IDS)[number]

export type RecommendPreset = {
  readonly id: PresetId
  readonly labelJa: string
  /** どういう人向けかを 1 行で（画面にそのまま出す）。 */
  readonly noteJa: string
  readonly metrics: readonly PresetMetric[]
}

/**
 * 6 軸の並び。表の列順もこれに揃える。
 * 期間はスキルの実走と同じ——将来人口は 20 年先（2020→2040）、増減率は 5 年ぶん。
 */
const AXES = [
  { metric: 'pop_gr_pred', labelJa: '将来人口', direction: 'higher', spanYears: 20 },
  { metric: 'pop_gr', labelJa: '実績人口', direction: 'higher', spanYears: 5 },
  { metric: 'lp_gr', labelJa: '地価トレンド', direction: 'higher', spanYears: 5 },
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
    ...axis,
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

// --- 災害の段階減点（§13.4-3） ------------------------------------------

/**
 * レベル → 減点の**表**。3 段の強さから選ぶ。
 *
 * ⚠ **表であることに意味がある。** `hazardLevelWeight(level) × 係数` と書くと、
 * 「警戒は注意の 2 倍」という**順序尺度には無い量**を勝手に決めたことになる。
 * 表なら、その 5 つの数字が誰の判断なのかが画面に出せる。
 *
 * 目盛りは**パーセンタイル／min-max（0〜1）を想定**している。`standard` の `critical` は
 * 0.20＝「エリア内で 20 パーセンタイルぶん下げる」に相当する。z-score はこの尺度ではないので、
 * 同じ表でも効き方が変わる（応答の注記で断る）。
 */
export const HAZARD_PENALTY_STEPS: Readonly<
  Record<HazardPenaltyId, Readonly<Record<HazardLevel, number>>>
> = {
  light: { none: 0, caution: 0.01, warning: 0.03, danger: 0.06, critical: 0.1 },
  standard: { none: 0, caution: 0.02, warning: 0.06, danger: 0.12, critical: 0.2 },
  heavy: { none: 0, caution: 0.05, warning: 0.12, danger: 0.25, critical: 0.4 },
}

/** 減点の強さの日本語（画面にそのまま出す）。 */
export const HAZARD_PENALTY_LABELS_JA: Readonly<Record<HazardPenaltyId, string>> = {
  light: '弱め',
  standard: '標準',
  heavy: '強め',
}
