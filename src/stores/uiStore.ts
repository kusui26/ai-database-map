/**
 * 画面全体の UI 状態（About の開閉）。Zustand。
 *
 * About（このアプリ・データ出典・ライセンス）は**2 か所から開く**——ヘッダの ⓘ と、
 * 地図の出典ピルの ⓘ（`docs/260828_fix_source_display.md` §3.2 決定 3）。
 * 後者は MapLibre のコントロールの中にある素の DOM ボタンなので、React の状態を
 * 渡せない。store に置けば `useUiStore.getState().openAbout()` で開ける。
 *
 * `aboutSeen` は「一度でも開いたか」。`AboutDialog` は初回オープンまで読み込まない
 * （初期バンドルから外す・docs/260804_loading_map.md §2）が、一度読み込んだら
 * 閉じてもマウントを保つ（再オープンで再取得しない）。
 */

import { create } from 'zustand'

type UiStore = {
  aboutOpen: boolean
  aboutSeen: boolean
  openAbout: () => void
  setAboutOpen: (open: boolean) => void
}

export const useUiStore = create<UiStore>((set) => ({
  aboutOpen: false,
  aboutSeen: false,
  openAbout: () => set({ aboutOpen: true, aboutSeen: true }),
  setAboutOpen: (open) => set((state) => ({ aboutOpen: open, aboutSeen: state.aboutSeen || open })),
}))
