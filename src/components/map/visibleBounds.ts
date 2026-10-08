/**
 * 地図のうち、パネルに隠れていない部分の範囲（純関数・2026-10-09 B3・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * チャットに同送する「地図の表示範囲」（2026-10-08 L3）は、以前は地図全体（`getBounds()`）だった。広い画面では
 * 左のチャット欄（余白＋420px）と、駅を選んだときの右の駅詳細が地図を覆うので、「このあたり」に**見えていない駅**が
 * 入ってしまう。隠れていない矩形の 4 隅を経度・緯度に戻して範囲にする（flyTo の余白と同じ考え方・`MapView.tsx`）。
 *
 * 図のキャンバスは数えない——図を見ているあいだは一時的に重なるだけで、「このあたり」は図を開く前に見ていた地図を指す。
 */

import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { type Viewport } from '@/shared/viewport'

/** 地図の左右でパネルに覆われる幅（px）。 */
export type MapInsets = { readonly left: number; readonly right: number }

/** 地図の左上を原点とするピクセルの点。 */
export type PixelPoint = readonly [number, number]

/** 覆われていない幅がこれより狭ければ、地図全体を範囲にする（パネルが地図とほぼ同じ幅の窓）。 */
export const MIN_VISIBLE_WIDTH_PX = 160

/** 広い画面で開いているパネル → 地図の左右の覆われる幅（モバイルのパネルは地図の上に重ねないので 0）。 */
export function mapInsets(isDesktop: boolean, chatOpen: boolean, drawerOpen: boolean): MapInsets {
  const side = PANEL_GAP_PX + PANEL_WIDTH_PX
  return { left: isDesktop && chatOpen ? side : 0, right: isDesktop && drawerOpen ? side : 0 }
}

/** 見えている矩形の 4 隅（左上・右上・左下・右下）。 */
export function visibleCorners(width: number, height: number, insets: MapInsets): PixelPoint[] {
  const narrow = width - insets.left - insets.right < MIN_VISIBLE_WIDTH_PX
  const left = narrow ? 0 : insets.left
  const right = narrow ? width : width - insets.right
  return [
    [left, 0],
    [right, 0],
    [left, height],
    [right, height],
  ]
}

/** 経度・緯度の点を囲む範囲（地図が回っていても 4 隅すべてを含む）。 */
export function boundsOf(
  points: readonly { readonly lng: number; readonly lat: number }[],
): Viewport {
  const lngs = points.map((point) => point.lng)
  const lats = points.map((point) => point.lat)
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  }
}
