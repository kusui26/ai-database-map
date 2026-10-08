/**
 * 絞り込みのポップオーバーを画面の中に収める位置（純関数・2026-10-08 L4）。
 *
 * ポップオーバーはボタンの左端から開く。ボタンが行の右のほうにあると、携帯の幅（390px）や右に寄った
 * キャンバスでは画面の外にはみ出して、右側の選択肢が押せなくなる。はみ出す分だけ左へずらし、
 * 画面より広ければ幅も縮める（測るのは `usePopoverPlacement`）。
 */

/** 画面の端からの余白。 */
export const VIEWPORT_MARGIN_PX = 8

export type PopoverPlacement = {
  /** ボタンの左端からのずれ（負＝左へ）。 */
  readonly offset_px: number
  readonly width_px: number
}

/** ボタンの左端・画面の幅・ほしい幅 → ずれと幅。 */
export function popoverPlacement(
  anchorLeft_px: number,
  viewportWidth_px: number,
  preferredWidth_px: number,
  margin_px: number = VIEWPORT_MARGIN_PX,
): PopoverPlacement {
  const width_px = Math.max(0, Math.min(preferredWidth_px, viewportWidth_px - 2 * margin_px))
  const maxLeft_px = viewportWidth_px - margin_px - width_px
  const left_px = Math.max(margin_px, Math.min(anchorLeft_px, maxLeft_px))
  return { offset_px: left_px - anchorLeft_px, width_px }
}
