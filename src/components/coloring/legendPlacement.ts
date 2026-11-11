'use client'

/**
 * 地図の色分けの凡例を、どこに出すか（2026-10-15 B5e・2026-11-11 に `ColoringHost` から切り出した）。
 *
 * 広い画面でエリアの図の列を開いていて、凡例が列の右に入らない幅なら（チャットと駅詳細も開いた 1440px など）、
 * **地図の凡例は出さない**——重ねると列の下に隠れる。そのときだけ、列のエリアの要約が同じ凡例（同じ分け方・`classify.ts`）を
 * 出す。ふだんは地図の凡例があるので、要約には出さない（文字を減らす・`docs/261110_fix_PLAN.md` §4.1）。
 *
 * 判定はここ 1 か所に置き、地図（`ColoringHost`）と列（`AreaBody`）が同じものを読む——2 か所でずれると、
 * 凡例がどこにも出ない（色だけが残る）か、2 か所に出る。
 */

import { useIsDesktop } from '@/hooks/useIsDesktop'
import { AREA_COLUMN_WIDTH_PX } from '@/hooks/useIsWide'
import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { useChatStore } from '@/stores/chatStore'
import { useAreaColumnOpen } from '@/components/figure/useAreaColumn'
import { useMapUrlState } from '@/components/map/useMapUrlState'

/** 駅詳細のドロワー（幅＋余白）を避けるときの右端（キャンバスと同じ算出）。 */
export const RIGHT_WITH_DETAIL_PX = PANEL_WIDTH_PX + PANEL_GAP_PX + PANEL_GAP_PX
/** 凡例の幅（`ColoringLegend` の `w-[min(18rem,…)]`）。 */
const LEGEND_WIDTH_PX = 288

/** エリアの図の列の右に凡例を置ける最小の画面幅（列の右端・余白・凡例・右の余白か駅詳細）。 */
export function minWidthForLegendBesideColumn(chatOpen: boolean, drawerOpen: boolean): number {
  const chat = chatOpen ? PANEL_GAP_PX + PANEL_WIDTH_PX : 0
  const columnRight = chat + PANEL_GAP_PX + AREA_COLUMN_WIDTH_PX
  const right = drawerOpen ? RIGHT_WITH_DETAIL_PX : PANEL_GAP_PX
  return columnRight + PANEL_GAP_PX + LEGEND_WIDTH_PX + right
}

/** 地図の凡例が、エリアの図の列に場所を取られて出ていないか（そのときは列の要約が凡例を出す）。 */
export function useMapLegendHiddenByColumn(): boolean {
  const { grp } = useMapUrlState()
  const chatOpen = useChatStore((state) => state.open)
  const areaColumnOpen = useAreaColumnOpen()
  const fitsBesideColumn = useIsDesktop(minWidthForLegendBesideColumn(chatOpen, grp !== null))
  return areaColumnOpen && !fitsBesideColumn
}
