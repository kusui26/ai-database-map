/**
 * src/components/chat/presentation：回答の図を、チャットのどこに出すか（2026-10-02・A4）。
 *
 * フィードバック #3「図は開いてしまって欲しい」。1024px ではランキングが開かずチップだけ、携帯では
 * 駅詳細のシートがチャットを覆って回答が読めなかった（`docs/261001_fix_user_feedback_ui.md` §4.1）。
 * 外に出す場所が無い幅では、会話の中に図を出す（§4.4(b)）。
 *
 * 幅の境界（639/640・1127/1128px）は matchMedia が決めるので、実ブラウザ（`ui.narrow-figures.smoke.py`）で確かめる。
 */

import { describe, expect, it } from 'vitest'
import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { CANVAS_MIN_WIDTH_PX, FIGURE_MIN_WIDTH_PX } from '@/hooks/useIsWide'
import { presentationOf, viewportOf, type Viewport } from '@/components/chat/presentation'

describe('viewportOf（幅の判定 → 区分）', () => {
  it('デスクトップでなければ携帯', () => {
    expect(viewportOf(false, false)).toBe('phone')
  })

  it('デスクトップで、キャンバスを併設できない幅は狭い画面', () => {
    expect(viewportOf(true, false)).toBe('narrow')
  })

  it('キャンバスを併設できる幅は広い画面', () => {
    expect(viewportOf(true, true)).toBe('wide')
  })

  it('広いのにデスクトップでない組合せ（起きない）は、携帯として扱う（シートを被せない側に倒す）', () => {
    expect(viewportOf(false, true)).toBe('phone')
  })
})

describe('presentationOf（図の種類 × 幅 → 出し方）', () => {
  const cases: ReadonlyArray<[Viewport, 'detail' | 'ranking' | 'scatter', 'chip' | 'inline']> = [
    // 広い画面：図の実体はチャットの外（駅詳細は右のパネル、ランキング・散布はキャンバス）。
    ['wide', 'detail', 'chip'],
    ['wide', 'ranking', 'chip'],
    ['wide', 'scatter', 'chip'],
    // 狭い画面：駅詳細は右のパネルに自動で開く。キャンバスは無いので、ランキング・散布は会話の中。
    ['narrow', 'detail', 'chip'],
    ['narrow', 'ranking', 'inline'],
    ['narrow', 'scatter', 'inline'],
    // 携帯：詳細のシートはチャットを覆うので、駅詳細も会話の中。
    ['phone', 'detail', 'inline'],
    ['phone', 'ranking', 'inline'],
    ['phone', 'scatter', 'inline'],
  ]

  it.each(cases)('%s で %s は %s', (viewport, kind, expected) => {
    expect(presentationOf(kind, viewport)).toBe(expected)
  })
})

describe('CANVAS_MIN_WIDTH_PX（キャンバスを併設できる最小幅）', () => {
  it('チャットを開いたまま、キャンバスにランキングの幅が入る最小の幅＝1128px', () => {
    // 左の余白＋チャット＋余白＋キャンバス＋右の余白。以前は 1108px の直書きで、チャットが
    // 400px だった頃の値のまま 20px 足りなかった（1108〜1127px でキャンバスがランキングより狭い）。
    const canvasLeft_px = PANEL_GAP_PX + PANEL_WIDTH_PX + PANEL_GAP_PX
    expect(CANVAS_MIN_WIDTH_PX - canvasLeft_px - PANEL_GAP_PX).toBe(FIGURE_MIN_WIDTH_PX)
    expect(CANVAS_MIN_WIDTH_PX).toBe(1128)
  })
})
