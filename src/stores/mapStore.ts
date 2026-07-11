/**
 * 地図の一時 UI 状態（URL に載せないもの）。Zustand。
 * 選択駅・半径は URL（nuqs）に載せる（共有リンク）。ここはホバー等の揮発状態。
 * Step2（P8b）でチャットの地図操作（ハイライト・任意 flyTo）もここを介して地図へ伝える。
 */

import { create } from 'zustand'

export type HoverInfo = {
  readonly name: string
  readonly x: number
  readonly y: number
}

/** チャットの flyTo 要求（同一座標でも seq で再実行させる・GUI Chat Protocol の mapAction）。 */
export type FlyToRequest = {
  readonly lon: number
  readonly lat: number
  readonly zoom?: number
  readonly seq: number
}

type MapStore = {
  hovered: HoverInfo | null
  setHovered: (info: HoverInfo | null) => void

  /** チャットがハイライトする駅群（ランキング上位など・地図に枠を描く）。 */
  highlightedGrps: readonly string[]
  setHighlightedGrps: (grps: readonly string[]) => void

  /** チャットの任意 flyTo（駅選択を伴わない移動）。 */
  flyTo: FlyToRequest | null
  requestFlyTo: (target: { lon: number; lat: number; zoom?: number }) => void
}

export const useMapStore = create<MapStore>((set) => ({
  hovered: null,
  setHovered: (info) => set({ hovered: info }),

  highlightedGrps: [],
  setHighlightedGrps: (grps) => set({ highlightedGrps: grps }),

  flyTo: null,
  requestFlyTo: (target) =>
    set((state) => ({ flyTo: { ...target, seq: (state.flyTo?.seq ?? 0) + 1 } })),
}))
