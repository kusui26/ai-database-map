/**
 * チャット UI の状態（Step2・P8b）。Zustand。
 *
 * チャットパネルの開閉、コンパクトカードの「⤢ 拡大＝昇格」先（ランキング/散布モーダル）、
 * 駅詳細昇格時の焦点カテゴリを保持する。選択駅・半径は URL（nuqs）が正で、ここには載せない。
 */

import { create } from 'zustand'
import { type DetailTab } from '@/shared/constants'
import { type Order } from '@/shared/api'

/** ⤢ 昇格の対象（クリックUIと同じモーダルへ・plan_fable §2.4 ルール③）。 */
export type Promotion =
  | {
      readonly kind: 'ranking'
      readonly metricKey: string
      readonly prefectures: readonly string[]
      /** 運営会社・路線・事業者種別の絞り込み（260801・散布と同じ意味）。 */
      readonly operators: readonly string[]
      readonly routes: readonly string[]
      readonly routeTypes: readonly number[]
      readonly order: Order
      readonly excludeLowN: boolean
    }
  | {
      readonly kind: 'scatter'
      readonly xKey: string
      readonly yKey: string
      readonly prefectures: readonly string[]
      /** 運営会社の絞り込み（260730・空＝全社）。 */
      readonly operators: readonly string[]
      /** 路線・事業者種別の絞り込み（260731・空＝全路線。両者は OR）。 */
      readonly routes: readonly string[]
      readonly routeTypes: readonly number[]
      readonly excludeLowN: boolean
    }

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

  /**
   * 駅詳細昇格時にドロワーで開く焦点タブ（1 回消費）。
   * **指標のカテゴリとは限らない**——災害タブも要求できるので `DetailTab` で持つ。
   */
  requestedCategory: DetailTab | null
  setRequestedCategory: (category: DetailTab | null) => void
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

  requestedCategory: null,
  setRequestedCategory: (category) => set({ requestedCategory: category }),
}))
