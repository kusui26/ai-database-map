import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABELS_JA,
  PANEL_GAP_PX,
  PANEL_WIDTH_CSS,
  PANEL_WIDTH_PX,
} from '@/shared/constants'

/**
 * 駅詳細のカテゴリのタブ帯（1440px 実測・2026-08-04）。
 * ここを下回る幅にすると**既定で横スライドが必要**になる（それが今回直した不具合）。
 */
const TAB_STRIP_WIDTH_PX = 404

/** 実測の内訳（docs/260804_station_window_width.md §1.2）。合計が上の値になる。 */
const TAB_WIDTHS_PX: Readonly<Record<string, number>> = {
  乗降客数: 80,
  人口: 52,
  地価: 52,
  バス: 52,
  事業所: 66,
  従業者: 66,
}
const TAB_GAP_PX = 4
const STRIP_PADDING_PX = 16

describe('併設パネルの幅（260804）', () => {
  it('タブ帯の実測内訳が 404px になる（幅を決めた根拠）', () => {
    const labels = Object.values(TAB_WIDTHS_PX)
    const total = labels.reduce((sum, w) => sum + w, 0)
    const gaps = TAB_GAP_PX * (labels.length - 1)
    expect(total + gaps + STRIP_PADDING_PX).toBe(TAB_STRIP_WIDTH_PX)
  })

  it('パネル幅がタブ帯を上回る＝既定でスライドしない', () => {
    expect(PANEL_WIDTH_PX).toBeGreaterThan(TAB_STRIP_WIDTH_PX)
  })

  it('余裕は 16px 以上（文言やフォントの微差で再発しない）', () => {
    expect(PANEL_WIDTH_PX - TAB_STRIP_WIDTH_PX).toBeGreaterThanOrEqual(16)
  })

  it('タブに使うカテゴリのラベルが実測時から変わっていない', () => {
    // ラベルが伸びると帯が広がり、上の不変条件が崩れる。変えたときは実測し直す。
    const labels = (
      ['passenger', 'population', 'land_price', 'bus', 'establishment', 'employee'] as const
    ).map((category) => CATEGORY_LABELS_JA[category])
    expect(labels).toEqual(Object.keys(TAB_WIDTHS_PX))
  })

  it('狭い画面では縮む（左右の余白ぶんを引いた min）', () => {
    expect(PANEL_WIDTH_CSS).toBe(`min(${PANEL_WIDTH_PX}px, calc(100% - ${PANEL_GAP_PX * 2}px))`)
    // 余白は Tailwind の `left-3` / `right-3`（12px）と同値でなければ左右がずれる。
    expect(PANEL_GAP_PX).toBe(12)
  })
})
