/**
 * 地図の一時 UI 状態（URL に載せないもの）。Zustand。
 * 選択駅・半径は URL（nuqs）に載せる（共有リンク）。ここはホバー等の揮発状態。
 * パネル開閉は P5 でここに追加する。
 */

import { create } from 'zustand'

export type HoverInfo = {
  readonly name: string
  readonly x: number
  readonly y: number
}

type MapStore = {
  hovered: HoverInfo | null
  setHovered: (info: HoverInfo | null) => void
}

export const useMapStore = create<MapStore>((set) => ({
  hovered: null,
  setHovered: (info) => set({ hovered: info }),
}))
