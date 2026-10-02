/**
 * 回答の図を、チャットのどこに出すか（2026-10-02・`docs/261001_fix_user_feedback_ui.md` §4.4(b)）。
 *
 * 広い画面は、図の実体をチャットの外（キャンバス・右の駅詳細）に出し、チャットには参照のチップだけを残す。
 * それより狭いと、外に出す場所が無いか、出すとチャットを覆う。そこで**会話の中に図を出す**（compact）。
 * ⤢ で、クリックの UI と同じ場所（モーダル・駅詳細のシート）へ広げる。
 *
 * | 画面幅 | 駅詳細 | ランキング・散布 |
 * |---|---|---|
 * | 広い | チップ（右の駅詳細が自動で開く） | チップ（キャンバスが自動で開く） |
 * | 狭い | チップ（右の駅詳細が自動で開く） | **会話の中** |
 * | 携帯 | **会話の中**（詳細のシートはチャットを覆うので自動では開かない） | **会話の中** |
 */

import { type PanelPromotion } from '@/shared/promotion'

/**
 * 画面幅の区分。
 * - `phone`：チャットも駅詳細もボトムシート（重なる）。`useIsDesktop` が false
 * - `narrow`：チャットは左、駅詳細は右のパネル。キャンバスを併設する幅は無い
 * - `wide`：キャンバスを併設できる（`CANVAS_MIN_WIDTH_PX` 以上）
 */
export type Viewport = 'phone' | 'narrow' | 'wide'

/** 幅の判定（`useIsDesktop`・`useIsWide`）→ 区分。広いのにデスクトップでない組合せは無いので、携帯を先に見る。 */
export function viewportOf(isDesktop: boolean, isWide: boolean): Viewport {
  if (!isDesktop) return 'phone'
  return isWide ? 'wide' : 'narrow'
}

/** `chip`＝参照だけ（実体はチャットの外）／`inline`＝会話の中に compact で出す。 */
export type Presentation = 'chip' | 'inline'

/** 図の種類ごとの出し方（1 つの幅ぶん）。 */
type PresentationByKind = Readonly<Record<PanelPromotion['kind'], Presentation>>

const PRESENTATIONS: Readonly<Record<Viewport, PresentationByKind>> = {
  wide: { detail: 'chip', ranking: 'chip', scatter: 'chip' },
  narrow: { detail: 'chip', ranking: 'inline', scatter: 'inline' },
  phone: { detail: 'inline', ranking: 'inline', scatter: 'inline' },
}

/** 図の種類 × 画面幅 → 出し方。 */
export function presentationOf(kind: PanelPromotion['kind'], viewport: Viewport): Presentation {
  return PRESENTATIONS[viewport][kind]
}
