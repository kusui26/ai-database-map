/**
 * ドメイン：「おすすめ駅」＝**絞り込みと、その理由の開示**の型
 * （`docs/260912_gui_chat_protocol.md` §13）。
 *
 * ここは純関数だけで完結させる（DB も HTTP もカタログも読まない）。
 * カタログのラベル解決は上の層の仕事——**この層は「どの key を、どの向きで、どの重みで」だけを見る**。
 *
 * ## なぜ向き（direction）を自前で持つのか
 *
 * カタログの `higherIsBetter` は全エントリで `null`（未設定）。「良い方向」は
 * **用途によって変わる**——地価は資産価値重視なら高いほど良く、予算重視なら安いほど良い。
 * 指標そのものの属性ではないので、カタログには昇格させず、**レシピ側の指定**として受け取る。
 *
 * ## 出力が「順位」だけにならないようにする
 *
 * 合成スコアは、内訳と、除外の理由と、揺らしたときの振る舞いが添わなければ読めない。
 * 型の側で**それらを省けないように**してある（`RecommendResult` の各フィールドは必須）。
 */

import type { HazardLevel } from '@/shared/constants'
import type { StationHazardSummary, SummaryHazardGroup } from '@/shared/hazard-summary'
import type {
  DegenerateReason,
  FlaggedPolicy,
  MetricDirection,
  NormalizeMethod,
} from '@/shared/recommend'

/**
 * 選択肢そのもの（正規化の方法・向き・⚠ の扱い）は `@/shared/recommend` にある。
 * ここから再輸出するのは、この層だけを読む人が語彙を辿れるようにするため。
 */
export type {
  FlaggedPolicy,
  MetricDirection,
  NormalizeMethod,
  HazardPolicyMode,
} from '@/shared/recommend'

/** 合成に使う指標 1 件。 */
export type ScoredMetric = {
  /** カタログの列 key（例 `pop_gr_2020_2015_1km`）。 */
  readonly key: string
  /** 高い方が良いのか、低い方が良いのか。 */
  readonly direction: MetricDirection
  /** 重み（負にしない。合計は 1 でなくてよい——内部で正規化する）。 */
  readonly weight: number
  /**
   * 値が信用できないときに立つフラグ列の key（カタログの `reliabilityFlagKey`）。
   * 無い指標は null。
   */
  readonly reliabilityFlagKey: string | null
}

/** 候補 1 駅。`values` は `datasetRows` の 1 行（列 key → 数値）そのまま。 */
export type CandidateStation = {
  readonly grp: string
  readonly name: string
  /** 列 key → 値。**欠損はキーごと無い**（0 ではない）。フラグ列も同じ入れ物に入る。 */
  readonly values: Readonly<Record<string, number>>
  /** 事前計算の災害サマリ。取れていない駅は null（＝不明であって安全ではない）。 */
  readonly hazard: StationHazardSummary | null
}

/** 災害の扱い。**線形加点はしない**（順序尺度なので）。 */
export type HazardPolicy =
  | { readonly mode: 'off' }
  /** 足切り：指定グループが `atOrAbove` 以上の駅を候補から外す。 */
  | {
      readonly mode: 'exclude'
      readonly group: SummaryHazardGroup
      readonly atOrAbove: HazardLevel
    }
  /** 段階減点：レベルごとの減点を**表で明示**する（掛け算ではない）。 */
  | {
      readonly mode: 'penalty'
      readonly group: SummaryHazardGroup
      readonly steps: Readonly<Record<HazardLevel, number>>
    }

export type RecommendOptions = {
  readonly metrics: readonly ScoredMetric[]
  readonly method: NormalizeMethod
  readonly hazard: HazardPolicy
  /** 既定は `annotate`（⚠ を付けて残す）。`exclude` なら候補から外す。 */
  readonly flagged?: FlaggedPolicy
  /** 敏感度と「上位」の件数。既定 5。 */
  readonly topN?: number
}

/** 駅が候補から外れた理由。**必ず理由を持つ**（黙って消さない）。 */
export type ExclusionReason =
  | { readonly kind: 'missing'; readonly keys: readonly string[] }
  | { readonly kind: 'flagged'; readonly keys: readonly string[] }
  | { readonly kind: 'hazard'; readonly group: SummaryHazardGroup; readonly level: HazardLevel }

export type ExcludedStation = {
  readonly grp: string
  readonly name: string
  readonly reason: ExclusionReason
}

/** 1 駅ぶんの内訳（どの指標がどれだけ効いたか）。 */
export type MetricContribution = {
  readonly key: string
  /** 生の値（単位はカタログ側。ここでは数値のまま運ぶ）。 */
  readonly raw: number
  /** 正規化後（向きを適用済み＝**大きいほど良い**）。 */
  readonly normalized: number
  /** 正規化後 × 正規化した重み。合計が合成スコアになる。 */
  readonly contribution: number
  /** ⚠ が立っている値（`annotate` のときだけ現れる）。 */
  readonly flagged: boolean
}

export type ScoredStation = {
  readonly grp: string
  readonly name: string
  readonly score: number
  readonly breakdown: readonly MetricContribution[]
  /** 災害の段階減点（`penalty` のときだけ非 0）。 */
  readonly hazardPenalty: number
  /** 区域図が無いグループがある＝**不明**（安全ではない）。 */
  readonly hazardUncovered: boolean
  /** 区域外だがすぐ近くが区域。 */
  readonly hazardNearby: boolean
}

/** 敏感度の結果。「頑健」か「僅差」かを言うための材料。 */
export type Sensitivity = {
  /** 重みを ±20% 振った回数（＝指標数 × 2）。 */
  readonly runs: number
  /** 上位 N の**顔ぶれと並び**が 1 度も変わらなかったか。 */
  readonly stable: boolean
  /** 入れ替わった隣り合う 2 駅（重複は畳む）。 */
  readonly swaps: readonly (readonly [string, string])[]
  /** 上位 N に出入りした駅。 */
  readonly enteredTop: readonly string[]
  readonly leftTop: readonly string[]
}

/** 正規化が効かなかった指標（全駅同値など）。**黙って 0.5 にしない**ために返す。 */
export type DegenerateMetric = {
  readonly key: string
  readonly reason: DegenerateReason
}

export type RecommendResult = {
  /** スコア降順。 */
  readonly ranked: readonly ScoredStation[]
  readonly excluded: readonly ExcludedStation[]
  readonly sensitivity: Sensitivity
  readonly degenerate: readonly DegenerateMetric[]
  /** 本文に 1 行で書くための、採った方法の控え。 */
  readonly method: NormalizeMethod
  /** 正規化後の重み（合計 1）。表の脚注にそのまま出す。 */
  readonly weights: Readonly<Record<string, number>>
  readonly hazard: HazardPolicy
  readonly flagged: FlaggedPolicy
}
