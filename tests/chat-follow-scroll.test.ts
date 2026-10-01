/**
 * src/components/chat/followScroll：回答が届くあいだ、チャットのスレッドを**どこまで送るか**（純関数）。
 *
 * 以前はスクロールの制御が何も無く、回答のたびに末尾までの残りが 303 → 1,161 → 2,020px と増えた
 * （2026-10-01 本番で実測・`docs/261001_fix_user_feedback_ui.md` §3）。いまは末尾まで送るが、
 * **質問＋回答が枠より高い**ときは末尾ではなく質問の頭で止める——末尾へ送ると回答の頭が隠れるため。
 *
 * 数字の読み方：枠の高さ 400px・中身 1,000px なら、末尾まで送ったときの scrollTop は 600px。
 */

import { describe, expect, it } from 'vitest'
import {
  FOLLOW_MARGIN_PX,
  followScrollTop,
  QUESTION_MARKER,
  QUESTION_SELECTOR,
} from '@/components/chat/followScroll'

const BOTTOM_PX = 600

describe('followScrollTop（追従先）', () => {
  it('質問が無ければ末尾', () => {
    expect(followScrollTop(BOTTOM_PX, null, FOLLOW_MARGIN_PX)).toBe(BOTTOM_PX)
  })

  it('質問＋回答が枠に収まる（質問の頭が末尾の位置より下）なら末尾', () => {
    expect(followScrollTop(BOTTOM_PX, 700, FOLLOW_MARGIN_PX)).toBe(BOTTOM_PX)
  })

  it('余白を足してちょうど収まるなら末尾（境界）', () => {
    expect(followScrollTop(BOTTOM_PX, BOTTOM_PX + FOLLOW_MARGIN_PX, FOLLOW_MARGIN_PX)).toBe(
      BOTTOM_PX,
    )
  })

  it('1px でもはみ出したら、質問の頭（の余白ぶん上）で止める', () => {
    const questionTop = BOTTOM_PX + FOLLOW_MARGIN_PX - 1
    expect(followScrollTop(BOTTOM_PX, questionTop, FOLLOW_MARGIN_PX)).toBe(BOTTOM_PX - 1)
  })

  it('長い回答なら、質問の頭を枠の上端（余白つき）に合わせる', () => {
    expect(followScrollTop(BOTTOM_PX, 250, FOLLOW_MARGIN_PX)).toBe(250 - FOLLOW_MARGIN_PX)
  })

  it('質問がスレッドの先頭にあり、余白で負になるなら 0', () => {
    expect(followScrollTop(BOTTOM_PX, 5, FOLLOW_MARGIN_PX)).toBe(0)
  })

  it('中身が枠に収まっている（末尾の位置が 0 以下）なら 0', () => {
    expect(followScrollTop(0, 40, FOLLOW_MARGIN_PX)).toBe(0)
    // ライブラリは「scrollHeight − 1 − clientHeight」を渡すので、はみ出しが無いと −1 が来る。
    expect(followScrollTop(-1, null, FOLLOW_MARGIN_PX)).toBe(0)
  })

  it('質問の位置が読めない値（NaN・無限）なら末尾に倒す', () => {
    expect(followScrollTop(BOTTOM_PX, Number.NaN, FOLLOW_MARGIN_PX)).toBe(BOTTOM_PX)
    expect(followScrollTop(BOTTOM_PX, Number.POSITIVE_INFINITY, FOLLOW_MARGIN_PX)).toBe(BOTTOM_PX)
  })

  it('余白はスレッドの上の余白（py-3 = 12px）と同じ', () => {
    expect(FOLLOW_MARGIN_PX).toBe(12)
  })
})

describe('質問の印（吹き出しに付ける属性と、探すセレクタ）', () => {
  it('付ける属性の名前と、探すセレクタの名前が一致する', () => {
    const [attribute] = Object.keys(QUESTION_MARKER)
    expect(QUESTION_SELECTOR).toBe(`[${attribute}]`)
  })
})
