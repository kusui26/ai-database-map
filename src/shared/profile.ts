/**
 * 駅周辺のプロフィールの**部品の形**（共通 API `GET /api/stations/[grp]/profile` の応答と、
 * GUI Chat Protocol のパネル `stationProfile` が共有する・2026-10-09 B4・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 * 応答全体（駅・出典つき）は `api.ts` の `stationProfileSchema`——ここは protocol からも読むので api.ts に依存しない。
 *
 * 「横浜駅の周辺はどんなエリア？」に 1 回で答えるための束：駅×半径の要点（人口と増減・将来、所得、地価の水準と増減、
 * 従業者・事業所、売上、乗降客数、バス）と、その**県内（あれば市内）での位置**、エリアの性格の目安、災害の要約、
 * **見ていないこと**。値・順位・性格・言い方はすべてドメイン（`src/domain/profile/`）が決め、画面と AI は同じものを読む。
 *
 * - 位置は値の大きい順（同じ値は同じ順位）。「上位」は値が大きい側で、良し悪しではない（地価の上位＝高い）
 * - 性格の目安は規則で決める（従業者 ÷ 人口・人と職場の密度）。LLM に決めさせない
 * - 災害は事前計算の要約（駅の代表点 1 点・想定最大規模の「もし起きたら」）。「安全」とは言わない
 */

import { z } from 'zod'
import { hazardLevelSchema } from './hazard'

/** 比べた範囲：県内（同じ都道府県）／市内（政令市は市全体・それ以外は市区町村）。 */
export const profileScopeSchema = z.enum(['prefecture', 'area'])
export type ProfileScope = z.infer<typeof profileScopeSchema>

/** 県内・市内での位置（値の大きい順）。 */
export const profilePositionSchema = z.object({
  scope: profileScopeSchema,
  /** 「神奈川県内」「横浜市内」。 */
  scopeJa: z.string(),
  /** 短い言い方（「県内」「都内」「市内」「区内」）。画面の行に出し、`scopeJa` は凡例と読み上げに使う。 */
  shortJa: z.string(),
  /** 値の大きい順の順位（1 ＝最も大きい。同じ値は同じ順位）。 */
  rank: z.number().int().min(1),
  /** 比べた駅の数（その指標の値がある駅だけ）。 */
  total: z.number().int().min(1),
  /** 0〜100（100 ＝最も大きい・0 ＝最も小さい）。目盛りの位置に使う。 */
  percentile: z.number().min(0).max(100),
  /** 「上位 19%」「下位 3%」。 */
  shareJa: z.string(),
  /** 「神奈川県内 348 駅中 66 位（上位 19%）」。 */
  labelJa: z.string(),
})
export type ProfilePosition = z.infer<typeof profilePositionSchema>

/** プロフィールに載せる指標（並びは `src/domain/profile/items.ts` が正）。 */
export const profileItemIdSchema = z.enum([
  'population',
  'populationChange',
  'populationFuture',
  'income',
  'landPrice',
  'landPriceChange',
  'employees',
  'establishments',
  'sales',
  'passengers',
  'busStops',
])
export type ProfileItemId = z.infer<typeof profileItemIdSchema>

/** 指標 1 つぶん（値・年・半径・位置）。 */
export const profileItemSchema = z.object({
  id: profileItemIdSchema,
  /** カタログの key（`pop_2020_1km`）。ランキング・データセットにそのまま渡せる。 */
  key: z.string(),
  /** 短い名前（「人口」「地価の増減」）。年と半径は別の欄に持つ。 */
  labelJa: z.string(),
  /** いつの値か（「2020年」「2015→2020年」「2020→2040年・R6推計」「2025年度」「現行」）。 */
  periodJa: z.string(),
  /** 集計の半径（m）。駅で決まる指標（乗降客数）は null。 */
  radiusM: z.number().nullable(),
  value: z.number().nullable(),
  /** 単位つきの値（「43,471 人」「+5.3%」）。欠損は「—」。 */
  valueJa: z.string(),
  /** 読むとき注意が要る値（母数が小さいなど・カタログのフラグ）。 */
  flagged: z.boolean(),
  /** 県内・市内での位置（比べる駅が少ない・値が無いときは空）。 */
  positions: z.array(profilePositionSchema),
  /** この指標だけに効く注意（半径を替えた・政令市の平均…）。無ければ null。 */
  noteJa: z.string().nullable(),
})
export type ProfileItem = z.infer<typeof profileItemSchema>

export const profileSectionIdSchema = z.enum(['people', 'landPrice', 'work', 'transport'])
export type ProfileSectionId = z.infer<typeof profileSectionIdSchema>

export const profileSectionSchema = z.object({
  id: profileSectionIdSchema,
  titleJa: z.string(),
  items: z.array(profileItemSchema),
})
export type ProfileSection = z.infer<typeof profileSectionSchema>

/** エリアの性格の目安（規則で決める・`src/domain/profile/character.ts`）。 */
export const areaCharacterKindSchema = z.enum([
  'business',
  'mixed',
  'residential',
  'sparse',
  'unknown',
])
export type AreaCharacterKind = z.infer<typeof areaCharacterKindSchema>

export const areaCharacterSchema = z.object({
  kind: areaCharacterKindSchema,
  /** 「業務地型」「住宅地型」。 */
  labelJa: z.string(),
  /** 1 文の意味（「働きに来る人が、住む人より多いエリア」）。 */
  summaryJa: z.string(),
  /** 根拠の数（「1km圏の従業者 179,031 人は、人口 43,471 人の 4.1 倍」）。 */
  basisJa: z.string(),
  /** 判定に使った半径（m）。選んだ半径によらず一定（目安の物差しを揃える）。 */
  radiusM: z.number(),
})
export type AreaCharacter = z.infer<typeof areaCharacterSchema>

/** 出典（データの出所と利用条件）。 */
export const profileSourceSchema = z.object({ source: z.string(), license: z.string() })
export type ProfileSource = z.infer<typeof profileSourceSchema>

/** 災害の要約（事前計算・駅の代表点 1 点・想定最大規模の「もし起きたら」）。 */
export const profileHazardSchema = z.object({
  /** 最も重い危険度（順序尺度）。画面は語ではなく色・記号で示す（`StationHazardBadge` と同じ規約）。 */
  level: hazardLevelSchema,
  /** 1 文の結論（サーバが作った文・「安全」と言わない）。 */
  headlineJa: z.string(),
  /** 該当した災害（重い順・「洪水：洪水浸水想定区域（想定最大規模）：0.5〜3m 未満」）。 */
  hitsJa: z.array(z.string()),
  /** すぐ近くが区域の災害（「洪水」）。 */
  nearbyJa: z.array(z.string()),
  /** この地域に区域図が無い災害（「津波」）。安全という意味ではない。 */
  uncoveredJa: z.array(z.string()),
  /** 必ず添える限界（代表点 1 点・想定最大規模・いまの警報ではない）。 */
  caveatJa: z.string(),
  /** 災害の出典（指標の出典とは分けて持つ——災害を出さない画面では一緒に消える）。 */
  sources: z.array(profileSourceSchema),
})
export type ProfileHazard = z.infer<typeof profileHazardSchema>
