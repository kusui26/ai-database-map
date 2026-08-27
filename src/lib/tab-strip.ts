/**
 * 横スライドするタブ帯の幾何（`docs/260828_fix_flood.md` §4.2）。
 *
 * 駅詳細のタブ帯は 9 タブで 572px になり、420px のパネルからはみ出す。**選んだタブが
 * 帯の外にあると、押しても何も起きていないように見える**——災害タブは末尾にあり、
 * 既定では完全に隠れているので、ここは必ず要る。
 *
 * DOM を触らない純関数にしてあるのは、**境界（ちょうど端にいる／既に見えている）を
 * テストで固定する**ため。実際のスクロールはこの値をブラウザに渡すだけである。
 */

/**
 * タブ帯の右端フェードの幅（px）。**いちばん狭いタブ（52px）より狭く**して、
 * タブ名そのものを覆い隠さないようにする（`tests/panel-layout.test.ts` が守る）。
 */
export const TAB_FADE_WIDTH_PX = 32

/** 見せる側の余白（px）。フェードと同じ幅にして、**選んだタブがフェードに隠れない**ようにする。 */
const TAB_REVEAL_MARGIN_PX = TAB_FADE_WIDTH_PX

/** スクロールする帯（測るのに要る 2 つだけ）。 */
export type TabStripMetrics = {
  readonly scrollLeft: number
  readonly clientWidth: number
}

/** 帯の中でのタブの位置（`offsetLeft` は帯を `relative` にして帯基準で測る）。 */
export type TabMetrics = {
  readonly offsetLeft: number
  readonly offsetWidth: number
}

/**
 * 選んだタブを見せるための `scrollLeft`。**既に見えているなら動かさない**
 * （選ぶたびに帯が跳ねると、隣のタブを続けて押せなくなる）。
 */
export function tabStripScrollLeft(strip: TabStripMetrics, tab: TabMetrics): number {
  const toShowLeftEdge = tab.offsetLeft - TAB_REVEAL_MARGIN_PX
  const toShowRightEdge =
    tab.offsetLeft + tab.offsetWidth + TAB_REVEAL_MARGIN_PX - strip.clientWidth
  if (strip.scrollLeft > toShowLeftEdge) return Math.max(toShowLeftEdge, 0)
  if (strip.scrollLeft < toShowRightEdge) return toShowRightEdge
  return strip.scrollLeft
}
