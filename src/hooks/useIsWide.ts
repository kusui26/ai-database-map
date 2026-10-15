'use client'

import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { useIsDesktop } from './useIsDesktop'

/** キャンバスに要る最低の幅（ランキングのダイアログ幅 `max-w-2xl` と同じ・260802 §3.4）。 */
export const FIGURE_MIN_WIDTH_PX = 672

/**
 * キャンバスを併設できる最小幅。チャット（左の余白＋パネル幅）・余白・キャンバス・右の余白の和。
 * これ未満では、図を会話の中に出す（`chat/presentation.ts`）。
 *
 * 以前は 1108px を直書きしていた。チャットの幅が 400px だった頃の値で、パネル幅を 420px にしたあとも
 * 残っていた（1108〜1127px では、キャンバスがランキングの幅より狭くなっていた・2026-10-02）。
 */
export const CANVAS_MIN_WIDTH_PX =
  PANEL_GAP_PX + PANEL_WIDTH_PX + PANEL_GAP_PX + FIGURE_MIN_WIDTH_PX + PANEL_GAP_PX

/**
 * 広い画面でエリアの図を出す列の幅（チャット・駅詳細と同じ幅・2026-10-15 B5e）。ランキング・散布のキャンバス（最大 896px）より
 * 狭くし、チャットの右に列として並べる——色分けした地図を、図を開いたまま横で見られるように。地図の寄せる余白もこの幅で列を避ける。
 */
export const AREA_COLUMN_WIDTH_PX = PANEL_WIDTH_PX

/** キャンバスを出せる画面幅か。 */
export function useIsWide(): boolean {
  return useIsDesktop(CANVAS_MIN_WIDTH_PX)
}
