/**
 * 寄せるときの余白（純関数・plan_fable §2.4 ルール④ → 2026-10-15 B5e で `MapView.tsx` から切り出し、エリアの図の列を足した）。
 *
 * 開いているパネル（左のチャット・右の駅詳細）の裏に駅を置かないように、その幅を余白にする。広い画面でエリアの図を開いていれば、
 * チャットの右に並ぶ列（`AREA_COLUMN_WIDTH_PX`）も避ける——色分けしたエリアの駅が列の裏に入らない。
 * 列も避けると見える幅が残らないとき（駅詳細も開いた 1128〜1400px）は列を避けない。MapLibre は余白の和が地図より広いと
 * 寄せない（"Map cannot fit within canvas"）ので、寄せられないより列の裏に寄せる方がよい。
 *
 * ランキング・散布のキャンバスは数えない（地図の大半を覆う。閉じると地図が見える・`visibleBounds.ts` と同じ考え）。
 */

import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { AREA_COLUMN_WIDTH_PX } from '@/hooks/useIsWide'
import { MIN_VISIBLE_WIDTH_PX } from './visibleBounds'

/** パネルの縁から離す余白（px）。 */
export const BASE_PAD_PX = 64

/** 開いているパネル。 */
export type OpenPanels = {
  readonly isDesktop: boolean
  readonly chatOpen: boolean
  readonly drawerOpen: boolean
  /** 広い画面でエリアの図の列を開いている。 */
  readonly areaColumnOpen: boolean
}

/** 寄せる余白（px・MapLibre の `PaddingOptions` にそのまま渡せる形）。 */
export type FlyPadding = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/** 開いているパネル幅を避けて、見えている部分の真ん中へ寄せる余白。 */
export function flyPadding(open: OpenPanels, mapWidthPx: number): FlyPadding {
  const left = BASE_PAD_PX + (open.isDesktop && open.chatOpen ? PANEL_WIDTH_PX : 0)
  const right = BASE_PAD_PX + (open.isDesktop && open.drawerOpen ? PANEL_WIDTH_PX : 0)
  const column = open.areaColumnOpen ? PANEL_GAP_PX + AREA_COLUMN_WIDTH_PX : 0
  const roomy = mapWidthPx - left - column - right >= MIN_VISIBLE_WIDTH_PX
  return { top: BASE_PAD_PX, bottom: BASE_PAD_PX, left: roomy ? left + column : left, right }
}
