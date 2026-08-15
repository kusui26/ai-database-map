import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABELS_JA,
  PANEL_GAP_PX,
  PANEL_WIDTH_CSS,
  PANEL_WIDTH_PX,
} from '@/shared/constants'
import { DETAIL_TABS } from '@/components/detail/StationDetailPanel'

/**
 * 駅詳細のカテゴリのタブ帯（1440px 実測・2026-08-04／所得タブ追加 2026-08-13）。
 *
 * 6 タブ時代は帯 404px < パネル 420px で**既定でスライドしなかった**が、所得タブを足した
 * 7 タブでは帯が 460px になり、**横スライドが要る**（docs/260805_research_add_dataset_economy.md
 * §16.3 で了承済み。パネルをさらに広げると地図が狭くなるため広げない）。
 *
 * そこで守る不変条件を「スライドしない」から「**スライドすると分かる**」に置き換える。
 * 最後のタブが完全に隠れると、そこにタブがあること自体に気づけないため。
 */
const TAB_WIDTHS_PX: Readonly<Record<string, number>> = {
  乗降客数: 80,
  人口: 52,
  所得: 52,
  地価: 52,
  バス: 52,
  事業所: 66,
  従業者: 66,
}
const TAB_GAP_PX = 4
const STRIP_PADDING_PX = 16
const TAB_STRIP_WIDTH_PX = 460

/** 最後のタブがこれだけ見えていれば「まだ続く」と分かる（実測 26px）。 */
const MIN_VISIBLE_LAST_TAB_PX = 20

/**
 * statTable の行幅（1440px・Chromium 実測 2026-08-16／docs/260816_stat_table_layout.md）。
 *
 * 行は「セル幅（＝パネル幅の半分）」で 2 列に詰み、**中身が収まらない行だけ** 1 行を占める。
 * ラベルを長くするときは、ここを実測し直して収まるか確かめる（収まらなければ 1 行になる）。
 */
const BODY_PADDING_PX = 16 // 詳細パネル本文の px-4
const ROW_GAP_PX = 16 // dl の gap-x-4
const STAT_TABLE_CELL_WIDTH_PX = 186
const MEASURED_ROW_WIDTHS_PX = {
  旧_総額_主語つき: 265, // 「課税対象所得 総額（2025年度）」＋「46,606,688 百万円」
  総額_年度のみ: 171, //   「2025年度」＋「44,019,580 百万円」
  所得増減率: 141, //       「2020→2025」＋「+57.0%」
  地価_公示価格: 171, //     「公示価格」＋「35,300,000 円/㎡」
  人口増減率: 141, //        「2000→2020」＋「+140.3%」
} as const

const tabWidths = Object.values(TAB_WIDTHS_PX)
const contentWidth = tabWidths.reduce((sum, w) => sum + w, 0) + TAB_GAP_PX * (tabWidths.length - 1)

describe('併設パネルの幅（260804・所得タブ追加 260813）', () => {
  it('タブ帯の実測内訳が 460px になる（幅を判断した根拠）', () => {
    expect(contentWidth + STRIP_PADDING_PX).toBe(TAB_STRIP_WIDTH_PX)
  })

  it('タブ帯がパネル幅を超える＝横スライドする（意図した状態）', () => {
    expect(TAB_STRIP_WIDTH_PX).toBeGreaterThan(PANEL_WIDTH_PX)
  })

  it('スライドしても最後のタブの一部が見える＝続きがあると分かる', () => {
    // 帯の可視幅はパネル幅から左右パディングを引いたぶん。そこからはみ出す量が隠れる。
    const visibleStripWidth = PANEL_WIDTH_PX - STRIP_PADDING_PX
    const hidden = contentWidth - visibleStripWidth
    const lastTabWidth = tabWidths[tabWidths.length - 1] ?? 0
    expect(hidden).toBeGreaterThan(0) // 上のテストと整合（隠れる＝スライドする）
    expect(lastTabWidth - hidden).toBeGreaterThanOrEqual(MIN_VISIBLE_LAST_TAB_PX)
  })

  it('タブに使うカテゴリのラベルが実測時から変わっていない', () => {
    // ラベルが伸びる／タブが増えると帯が広がり、上の不変条件が崩れる。変えたときは実測し直す。
    const labels = DETAIL_TABS.map((category) => CATEGORY_LABELS_JA[category])
    expect(labels).toEqual(Object.keys(TAB_WIDTHS_PX))
  })

  it('statTable は「半分に収まる行」を 2 列に詰め、収まらない行だけ 1 行を占める（260816）', () => {
    // セル幅＝(パネル幅 − 本文の左右パディング − 列ギャップ) ÷ 2。StatTable の
    // `basis-[calc(50%-0.5rem)]` はこの幅を指す（実測 186px）。
    const cellWidth = (PANEL_WIDTH_PX - BODY_PADDING_PX * 2 - ROW_GAP_PX) / 2
    expect(cellWidth).toBe(STAT_TABLE_CELL_WIDTH_PX)

    // 主語をラベルに書いていた頃の総額行は、セルに 79px 収まらず隣の列に重なっていた。
    expect(MEASURED_ROW_WIDTHS_PX.旧_総額_主語つき).toBeGreaterThan(cellWidth)

    // いまの行はすべてセルに収まる＝ 2 列のまま（主語は表題へ移した）。
    const current = [
      MEASURED_ROW_WIDTHS_PX.総額_年度のみ,
      MEASURED_ROW_WIDTHS_PX.所得増減率,
      MEASURED_ROW_WIDTHS_PX.地価_公示価格,
      MEASURED_ROW_WIDTHS_PX.人口増減率,
    ]
    for (const width of current) expect(width).toBeLessThanOrEqual(cellWidth)
  })

  it('狭い画面では縮む（左右の余白ぶんを引いた min）', () => {
    expect(PANEL_WIDTH_CSS).toBe(`min(${PANEL_WIDTH_PX}px, calc(100% - ${PANEL_GAP_PX * 2}px))`)
    // 余白は Tailwind の `left-3` / `right-3`（12px）と同値でなければ左右がずれる。
    expect(PANEL_GAP_PX).toBe(12)
  })
})
