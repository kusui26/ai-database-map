/**
 * チャット UI の状態（Step2・P8b）。Zustand。
 *
 * チャットパネルの開閉と、回答の図を自動で開いた記録（同じ回答で二度開かない）を保持する。
 * 選択駅・半径・駅詳細のタブ・開いている図は URL（nuqs）が正で、ここには載せない
 * （タブは 2026-10-02 に、図は同日に URL へ移した・`components/detail/useDetailTab.ts`・
 * `components/figure/url.ts`）。
 */

import { create } from 'zustand'

type ChatStore = {
  /** 左サイドチャットパネル（モバイルはボトムシート）の開閉。 */
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void

  /**
   * 自動表示で最後に適用した回答の鍵（`canvasTargetOf` の key）。
   * 同じ回答では二度と自動で開かないための記録で、閉じても消さない（260802）。
   * 「戻る」で閉じた図が、効果の再実行で開き直さないためにも要る。
   */
  canvasKey: string | null
  setCanvasKey: (key: string) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),

  canvasKey: null,
  setCanvasKey: (canvasKey) => set({ canvasKey }),
}))
