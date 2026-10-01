'use client'

/**
 * チャットのスレッドの追従。`use-stick-to-bottom` に、このアプリの事情を 3 つ足した薄い包み（2026-10-02）。
 *
 * ライブラリが受け持つこと：中身が伸びたら追従先へ送る／利用者が上へスクロールしたら追わない
 * （ホイール・タッチ・文字の選択）／なめらかな送り。
 *
 * ここで足すこと（`docs/261001_fix_user_feedback_ui.md` §3）：
 * 1. **追従先**：質問＋回答が枠より高いときは、末尾ではなく質問の頭で止める（`followScroll.ts`）。
 *    ライブラリは**最初の描画で渡した関数を使い続ける**ので、関数は外に置き、位置は毎回 DOM から読む。
 * 2. **枠の高さの変化**：ライブラリは中身の伸びしか見ない。下のサジェストや「現在の対象」が出入りして
 *    枠が縮むと、末尾が隠れたまま残る。枠が広がると、ブラウザが詰めたスクロールを「利用者が上へ戻した」
 *    と取り違えて追従が外れる。どちらも、**追従していたなら**追従先へ寄せ直す。
 * 3. **動きを減らす設定**（`prefers-reduced-motion`）では、なめらかに送らず一度に送る。
 */

import { useCallback, useRef } from 'react'
import {
  useStickToBottom,
  type GetTargetScrollTop,
  type ScrollElements,
  type StickToBottomOptions,
} from 'use-stick-to-bottom'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { FOLLOW_MARGIN_PX, followScrollTop, QUESTION_SELECTOR } from './followScroll'

/**
 * 枠の高さが変わってから追従を戻すまでの、最後の待ち（2 フレームのあと）。
 *
 * 枠が広がると、ブラウザは詰めたスクロールの scroll イベントを**その次のフレーム**で出すことがあり、
 * ライブラリはそれを受けて `setTimeout(1)` のあとに「上へ戻した」と判定する。2 フレーム待てば
 * その判定の予約は済んでいて、ここで予約するタイマはその後に走る（先に戻すと、判定で外され直す）。
 */
const RELOCK_DELAY_MS = 16

/** 次の 2 フレームが過ぎ、さらに少し待ってから実行する（枠の変化によるスクロールの判定を先に済ませる）。 */
function afterScrollSettles(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(run, RELOCK_DELAY_MS)))
}

/** 最後の質問の頭（スレッドの中身の座標）。質問が無ければ null。 */
function latestQuestionTop({ scrollElement, contentElement }: ScrollElements): number | null {
  const questions = contentElement.querySelectorAll(QUESTION_SELECTOR)
  const last = questions.item(questions.length - 1)
  if (last === null) return null
  const offset_px = last.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top
  return offset_px + scrollElement.scrollTop
}

/** ライブラリに渡す追従先。最初の描画のものが使われ続けるので、状態を閉じ込めない。 */
const targetScrollTop: GetTargetScrollTop = (bottom, elements) =>
  followScrollTop(bottom, latestQuestionTop(elements), FOLLOW_MARGIN_PX)

/** 動きを減らす設定なら一度に送り、そうでなければライブラリのなめらかな送り。 */
function stickOptions(reducedMotion: boolean): StickToBottomOptions {
  // 開いた直後（中身を初めて測ったとき）は、上から流して見せる意味が無いので一度に送る。
  return reducedMotion
    ? { initial: 'instant', resize: 'instant', targetScrollTop }
    : { initial: 'instant', targetScrollTop }
}

/** 枠（スクロールする箱）の高さが変わったら、追従していたときだけ `relock` する。 */
function observeFrameHeight(
  element: HTMLElement,
  isFollowing: () => boolean,
  relock: () => void,
): ResizeObserver {
  let previousHeight_px: number | null = null
  const observer = new ResizeObserver(([entry]) => {
    const height_px = entry?.contentRect.height ?? null
    const changed = previousHeight_px !== null && height_px !== previousHeight_px
    previousHeight_px = height_px
    // 追従していたかは**いま**読む（ライブラリが取り違えて外すのは、この後のスクロールの判定）。
    if (changed && isFollowing()) afterScrollSettles(relock)
  })
  observer.observe(element)
  return observer
}

export type ChatScroll = {
  /** スクロールする箱に付ける。 */
  readonly scrollRef: (element: HTMLElement | null) => void
  /** 伸びる中身に付ける。 */
  readonly contentRef: (element: HTMLElement | null) => void
  /** 最新の質問と回答へ送る（送信したとき・「最新の回答へ」を押したとき）。 */
  readonly scrollToLatest: () => void
  /** 追従先（最新の質問と回答）が見えているか。見えていなければ「最新の回答へ」を出す。 */
  readonly isAtLatest: boolean
}

export function useChatScroll(): ChatScroll {
  const reducedMotion = usePrefersReducedMotion()
  const stick = useStickToBottom(stickOptions(reducedMotion))
  const { scrollRef: attachScroll, scrollToBottom, state } = stick
  const frameObserver = useRef<ResizeObserver | null>(null)

  const scrollRef = useCallback(
    (element: HTMLElement | null) => {
      attachScroll(element)
      frameObserver.current?.disconnect()
      frameObserver.current =
        element === null
          ? null
          : observeFrameHeight(
              element,
              () => state.isAtBottom,
              () => void scrollToBottom({ animation: 'instant' }),
            )
    },
    [attachScroll, scrollToBottom, state],
  )
  const scrollToLatest = useCallback(
    () => void scrollToBottom(reducedMotion ? 'instant' : undefined),
    [scrollToBottom, reducedMotion],
  )

  return { scrollRef, contentRef: stick.contentRef, scrollToLatest, isAtLatest: stick.isAtBottom }
}
