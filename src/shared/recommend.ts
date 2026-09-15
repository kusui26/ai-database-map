/**
 * 「おすすめ駅」の**語彙**（Zod・`docs/260912_gui_chat_protocol.md` §13）。
 *
 * ここに置くのは「どんな選択肢があるか」だけで、**中身（重みの値・減点の表・計算）は
 * `src/domain/recommend/` が持つ**。分けてあるのは層の向きのため——`shared` は最下層で、
 * `domain` も `app/api` も UI もここを参照してよいが、ここから上を参照してはいけない。
 *
 * 型はここの Zod から `z.infer` で導く（CLAUDE.md §3「Zod からは z.infer で導出」）。
 * 同じ列挙を domain と API で二度書くと、片方だけ増えたときに静かにずれる。
 */

import { z } from 'zod'

/**
 * 正規化の方法。**1 回の合成では 1 つだけ**（混ぜない）。
 * Web の既定はパーセンタイル——「エリア内で上位 12%」と説明でき、⚠ の外れ値に強い（§13.4）。
 */
export const normalizeMethodSchema = z.enum(['percentile', 'minmax', 'zscore'])
export type NormalizeMethod = z.infer<typeof normalizeMethodSchema>

/**
 * 指標の「良い方向」。**カタログには持たせない**——地価は資産価値重視なら高いほど良く、
 * 予算重視なら安いほど良い。指標の属性ではなく**用途の属性**なので、レシピが指定する。
 */
export const metricDirectionSchema = z.enum(['higher', 'lower'])
export type MetricDirection = z.infer<typeof metricDirectionSchema>

/** ⚠（信頼性フラグ）が立った値の扱い。どちらも「黙って使う」ではない。 */
export const flaggedPolicySchema = z.enum(['exclude', 'annotate'])
export type FlaggedPolicy = z.infer<typeof flaggedPolicySchema>

/**
 * 災害の扱い方。**線形加点は選択肢に無い**——危険度は順序尺度なので、
 * 重みを掛けて足すことはできない（§13.4-3）。
 */
export const hazardPolicyModeSchema = z.enum(['off', 'exclude', 'penalty'])
export type HazardPolicyMode = z.infer<typeof hazardPolicyModeSchema>

/** 段階減点の強さ。レベル → 減点の**表**を選ぶ（係数を掛けるのではない）。 */
export const hazardPenaltyIdSchema = z.enum(['light', 'standard', 'heavy'])
export type HazardPenaltyId = z.infer<typeof hazardPenaltyIdSchema>

/** 重みの初期値（ペルソナ）。ラベルと数値は domain 側にある。 */
export const recommendPresetIdSchema = z.enum(['family', 'asset', 'convenience', 'budget'])
export type RecommendPresetId = z.infer<typeof recommendPresetIdSchema>

/** 駅が候補から外れた理由の種別。**必ずどれかを言う**（黙って消さない）。 */
export const exclusionKindSchema = z.enum(['missing', 'flagged', 'hazard'])
export type ExclusionKind = z.infer<typeof exclusionKindSchema>

/** 正規化が効かなかった理由（全駅同値・駅が少なすぎる）。 */
export const degenerateReasonSchema = z.enum(['no-spread', 'too-few'])
export type DegenerateReason = z.infer<typeof degenerateReasonSchema>
