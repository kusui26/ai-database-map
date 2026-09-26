/**
 * ⤢ 昇格の条件（チャットの図を、クリックUIと同じドロワー・モーダル・キャンバスで開くときの条件）。
 * サーバが作り、画面はそのまま使う（サーバと画面で共有する約束）。
 *
 * ## なぜサーバが作るか（2026-09-26）
 *
 * 以前は画面が、パネルとメッセージ内のツール呼び出しを照合して条件を推し量っていた（「ラベルが
 * 合う最初の呼び出し」）。同じ指標で呼び出しが 2 つあると、どちらの図も最初の呼び出しに結びつき、
 * ⤢ もキャンバスも**別の図の条件**で開いた（例：「該当 0 件」の図の条件で、100 点の図を開く）。
 * サーバは図を生んだ条件そのもの（副産物＝ツールの応答）を持っているので、推し量る必要が無い
 * （.claude/CLAUDE.md §2「意味づけは共通 API が持つ」）。
 */

import { z } from 'zod'
import { orderSchema } from './api'
import { categorySchema } from './catalog'

/** 絞り込み（空＝絞らない）。ランキングと散布で同じ意味。 */
const filtersShape = {
  prefectures: z.array(z.string()),
  operators: z.array(z.string()),
  routes: z.array(z.string()),
  /** 事業者種別のコード（表示名ではない）。 */
  routeTypes: z.array(z.number()),
  /** 信頼性の低い値（⚠）を除外する。 */
  excludeLowN: z.boolean(),
}

export const rankingPromotionSchema = z.object({
  kind: z.literal('ranking'),
  metricKey: z.string(),
  order: orderSchema,
  ...filtersShape,
})

export const scatterPromotionSchema = z.object({
  kind: z.literal('scatter'),
  xKey: z.string(),
  yKey: z.string(),
  ...filtersShape,
})

/** 駅詳細（右ドロワーを駅＋焦点タブで開く）。 */
export const detailPromotionSchema = z.object({
  kind: z.literal('detail'),
  grp: z.string(),
  category: categorySchema.nullable(),
})

export const panelPromotionSchema = z.discriminatedUnion('kind', [
  rankingPromotionSchema,
  scatterPromotionSchema,
  detailPromotionSchema,
])

/**
 * パネルと**同じ並び**の昇格。図の先頭パネル（駅カード・順位表・散布）にだけ条件が入り、
 * それ以外（駅詳細の本文のグラフ・ハザードのカード等）は null。
 */
export const panelPromotionsSchema = z.array(panelPromotionSchema.nullable())

export type RankingPromotion = z.infer<typeof rankingPromotionSchema>
export type ScatterPromotion = z.infer<typeof scatterPromotionSchema>
export type DetailPromotion = z.infer<typeof detailPromotionSchema>
export type PanelPromotion = z.infer<typeof panelPromotionSchema>
export type PanelPromotions = z.infer<typeof panelPromotionsSchema>

/** モーダル・キャンバスで開く昇格（ランキング／散布）。駅詳細は右ドロワーが担当する。 */
export type Promotion = RankingPromotion | ScatterPromotion
