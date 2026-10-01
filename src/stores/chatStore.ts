/**
 * チャット UI の状態（Step2・P8b）。Zustand。
 *
 * チャットパネルの開閉と、コンパクトカードの「⤢ 拡大＝昇格」先（ランキング/散布）を保持する。
 * 選択駅・半径・駅詳細のタブは URL（nuqs）が正で、ここには載せない（タブは 2026-10-02 に URL へ移した・
 * `components/detail/useDetailTab.ts`）。
 */

import { create } from 'zustand'
import { type Promotion } from '@/shared/promotion'

type ChatStore = {
  /** 左サイドチャットパネル（モバイルはボトムシート）の開閉。 */
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void

  /** ランキング/散布の昇格要求（広い画面はキャンバス、narrow は PromotionHost がモーダルで開く）。 */
  promotion: Promotion | null
  /** 同一 promotion でも再マウントさせるための単調増加シーケンス。 */
  promotionSeq: number
  promote: (promotion: Promotion) => void
  clearPromotion: () => void

  /**
   * 自動表示で最後に適用した回答の鍵（`canvasTargetOf` の key）。
   * 同じ回答では二度と自動で開かないための記録で、閉じても消さない（260802）。
   */
  canvasKey: string | null
  setCanvasKey: (key: string) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),

  promotion: null,
  promotionSeq: 0,
  promote: (promotion) => set((state) => ({ promotion, promotionSeq: state.promotionSeq + 1 })),
  clearPromotion: () => set({ promotion: null }),

  canvasKey: null,
  setCanvasKey: (canvasKey) => set({ canvasKey }),
}))
