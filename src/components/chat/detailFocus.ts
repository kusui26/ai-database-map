/**
 * 回答の ⤢ の条件から、**駅詳細をどのタブで開くか**（焦点）を決める純関数（2026-10-02）。
 *
 * AI が「東京駅の人口推移」を聞かれて駅詳細を出すと、地図操作（`selectStation`）がドロワーを
 * 自動で開く。その操作は焦点を持たないので、以前は乗降客数タブで開いていた——人口のグラフは
 * チップを押すまで出なかった（`docs/261001_fix_user_feedback_ui.md` §4）。焦点はサーバが
 * ⤢ の条件（data-promotions）に**すでに載せている**ので、それを読む（同じ意味を 2 か所に持たせない）。
 */

import { detailTabFor, type DetailTab } from '@/shared/constants'
import {
  panelPromotionsSchema,
  type DetailPromotion,
  type PanelPromotion,
  type PanelPromotions,
} from '@/shared/promotion'

/** 駅詳細の焦点（どの駅を、どのタブで開くか）。 */
export type DetailFocus = {
  readonly grp: string
  readonly tab: DetailTab
}

function isDetailPromotion(promotion: PanelPromotion | null): promotion is DetailPromotion {
  return promotion !== null && promotion.kind === 'detail'
}

/**
 * 駅詳細をどのタブで開くか。指標ではないタブ（「概要」＝駅周辺のプロフィール・2026-10-09 B4）が先、
 * 次に聞かれた指標のカテゴリ。どちらも無ければ null（タブは触らず、覚えたタブのまま開く）。
 */
export function focusTabOf(promotion: DetailPromotion): DetailTab | null {
  if (promotion.tab !== undefined) return promotion.tab
  return promotion.category === null ? null : detailTabFor(promotion.category)
}

/**
 * 最後の駅詳細の焦点。地図が最後に選ぶ駅は最後の駅詳細の駅なので、それに合わせる。
 * 最後の駅詳細に焦点が無い（`category: null` でタブの指定も無い）なら null——タブは触らず、覚えたタブのまま開く。
 */
export function detailFocusOf(promotions: PanelPromotions): DetailFocus | null {
  const last = promotions.filter(isDetailPromotion).at(-1)
  const tab = last === undefined ? null : focusTabOf(last)
  return last === undefined || tab === null ? null : { grp: last.grp, tab }
}

/** 同じ焦点かを見分ける鍵（ツールが成功するたびに条件が送り直されても、1 回だけ当てるため）。 */
export function detailFocusKey(focus: DetailFocus): string {
  return JSON.stringify([focus.grp, focus.tab])
}

/** これから当てる焦点と、その鍵。 */
export type FocusToApply = {
  readonly focus: DetailFocus
  readonly key: string
}

/**
 * data-promotions の中身（未検証）から、**いま当てるべき**焦点。
 * 形が合わない・焦点が無い・この回答で既に当てた（`appliedKey` と同じ）なら null。
 */
export function focusToApply(data: unknown, appliedKey: string | null): FocusToApply | null {
  const parsed = panelPromotionsSchema.safeParse(data)
  const focus = parsed.success ? detailFocusOf(parsed.data) : null
  if (focus === null) return null
  const key = detailFocusKey(focus)
  return key === appliedKey ? null : { focus, key }
}
