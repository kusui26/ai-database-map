'use client'

import { useIsDesktop } from './useIsDesktop'

/**
 * キャンバスを併設できる最小幅（260802）。
 * チャット（左 12＋幅 400）＋余白 12 でキャンバスの左端が 424px、
 * そこにランキングのダイアログ幅 672px と右余白 12px を確保できる幅。
 * これ未満では併設が窮屈なので、従来どおりモーダルで開く
 * （docs/260802_ai_chat_canvs.md §3.4）。
 */
export const CANVAS_MIN_WIDTH_PX = 1108

/** キャンバスを出せる画面幅か。 */
export function useIsWide(): boolean {
  return useIsDesktop(CANVAS_MIN_WIDTH_PX)
}
