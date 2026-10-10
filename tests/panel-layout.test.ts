import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DETAIL_TAB_LABELS_JA,
  DETAIL_TABS,
  PANEL_GAP_PX,
  PANEL_WIDTH_CSS,
  PANEL_WIDTH_PX,
} from '@/shared/constants'
import { TAB_FADE_WIDTH_PX, tabStripScrollLeft } from '@/lib/tab-strip'

/**
 * 駅詳細のタブ帯（1440px 実測・2026-08-04／所得 2026-08-13／売上 2026-08-17／災害 2026-08-28／概要 2026-10-09）。
 *
 * 6 タブ時代は帯 404px < パネル 420px で**既定でスライドしなかった**。所得で 7 タブ・460px に
 * なって横スライドが要るようになり、売上で 8 タブ・516px、**災害で 9 タブ・572px** になった
 * （docs/260805_research_add_dataset_economy.md §16.3。パネルを広げると地図が狭くなるため広げない）。
 *
 * 守る不変条件はここで一段変わる。
 *   6 タブ: 「スライドしない」
 *   7 タブ: 「スライドしても最後のタブが 26px 見える＝続きがあると分かる」
 *   8 タブ: **最後のタブは完全に隠れる**ので、その代わりに**右端のフェードで示す**
 *           （docs/260816_sales.md §7.4 の案A）。フェードはタブ名を覆い隠さない幅にする。
 *   9 タブ: 同じ条件のまま。ただし**選んだタブは帯を送って見せる**——災害タブは末尾にあり、
 *           バッジから飛んだときに見えないままだと壊れて見える（docs/260828_fix_flood.md §4.2）。
 *  10 タブ: 概要（駅周辺のプロフィール・B4）を**先頭**に足して 628px。条件は 9 タブと同じ
 *           （`docs/261001_fix_user_feedback_ui.md` §12-7——ヘッダに要約を置く案はヘッダが伸びるので採らない）。
 */
const TAB_WIDTHS_PX: Readonly<Record<string, number>> = {
  概要: 52,
  乗降客数: 80,
  人口: 52,
  所得: 52,
  売上: 52,
  地価: 52,
  バス: 52,
  事業所: 66,
  従業者: 66,
  災害: 52,
}
const TAB_GAP_PX = 4
const STRIP_PADDING_PX = 16
const TAB_STRIP_WIDTH_PX = 628

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
  it('タブ帯の実測内訳が 628px になる（幅を判断した根拠）', () => {
    expect(contentWidth + STRIP_PADDING_PX).toBe(TAB_STRIP_WIDTH_PX)
  })

  it('タブ帯がパネル幅を超える＝横スライドする（意図した状態）', () => {
    expect(TAB_STRIP_WIDTH_PX).toBeGreaterThan(PANEL_WIDTH_PX)
  })

  it('10 タブでも最後のタブは完全に隠れる＝フェードで示すしかない（案A を選んだ理由）', () => {
    // 帯の可視幅はパネル幅から左右パディングを引いたぶん。そこからはみ出す量が隠れる。
    const visibleStripWidth = PANEL_WIDTH_PX - STRIP_PADDING_PX
    const hidden = contentWidth - visibleStripWidth
    const lastTabWidth = tabWidths[tabWidths.length - 1] ?? 0
    expect(hidden).toBeGreaterThan(0) // スライドする
    // 7 タブまでは「最後のタブが 20px 以上見える」で気づけたが、8 タブ以降は隠れ量が幅を超える。
    expect(lastTabWidth - hidden).toBeLessThan(0)
  })

  it('右端のフェードはタブ名を覆い隠さない幅（いちばん狭いタブより狭い）', () => {
    // 覆いすぎると「隠れているのはフェードのせい」に見え、タブの存在が余計に分からなくなる。
    expect(TAB_FADE_WIDTH_PX).toBeLessThan(Math.min(...tabWidths))
    expect(TAB_FADE_WIDTH_PX).toBeGreaterThan(0)
  })

  it('タブのラベルと並びが実測時から変わっていない（概要が先頭・災害は末尾）', () => {
    // ラベルが伸びる／タブが増えると帯が広がり、上の不変条件が崩れる。変えたときは実測し直す。
    const labels = DETAIL_TABS.map((tab) => DETAIL_TAB_LABELS_JA[tab])
    expect(labels).toEqual(Object.keys(TAB_WIDTHS_PX))
    expect(labels[0]).toBe('概要') // 261001 §12-7：先頭
    expect(labels[labels.length - 1]).toBe('災害') // §7 決定 2：末尾
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

/**
 * 帯を送って「選んだタブ」を見せる（`src/lib/tab-strip.ts`・実測 2026-08-28）。
 *
 * 数字はすべて 1440px の Chromium で測ったもの——災害タブは `offsetLeft=568`・幅 52px、
 * 帯の可視幅は 420px（PC）／390px（モバイル）、`scrollWidth` は 628px（概要を足した 2026-10-09 に測り直した）。
 * バッジから飛んだのにタブ帯が動かないと、**押しても何も起きていないように見える**。
 */
describe('タブ帯のスクロール位置（260828）', () => {
  const HAZARD_TAB = { offsetLeft: 568, offsetWidth: 52 }
  const FIRST_TAB = { offsetLeft: STRIP_PADDING_PX / 2, offsetWidth: 80 }
  const VISIBLE_WIDTH_PX = PANEL_WIDTH_PX // 帯はパネル幅いっぱいに広がる

  it('末尾の災害タブを選ぶと、右端まで送って見せる', () => {
    const left = tabStripScrollLeft({ scrollLeft: 0, clientWidth: VISIBLE_WIDTH_PX }, HAZARD_TAB)
    // 右端が見える位置＋フェードに隠れない余白。ブラウザ側で最大値（628−420＝208）に丸まる。
    expect(left).toBe(
      HAZARD_TAB.offsetLeft + HAZARD_TAB.offsetWidth + TAB_FADE_WIDTH_PX - VISIBLE_WIDTH_PX,
    )
    expect(left).toBeGreaterThan(TAB_STRIP_WIDTH_PX - VISIBLE_WIDTH_PX) // ＝右端まで送られる
  })

  it('先頭のタブへ戻ると、左端まで戻す（負の位置にはしない）', () => {
    const left = tabStripScrollLeft(
      { scrollLeft: TAB_STRIP_WIDTH_PX - VISIBLE_WIDTH_PX, clientWidth: VISIBLE_WIDTH_PX },
      FIRST_TAB,
    )
    expect(left).toBe(0)
  })

  it('すでに見えているタブでは動かさない（選ぶたびに帯が跳ねない）', () => {
    const visible = { offsetLeft: 140, offsetWidth: 52 }
    expect(tabStripScrollLeft({ scrollLeft: 0, clientWidth: VISIBLE_WIDTH_PX }, visible)).toBe(0)
  })

  it('送った先で、選んだタブが右端のフェードに隠れない', () => {
    const left = tabStripScrollLeft({ scrollLeft: 0, clientWidth: VISIBLE_WIDTH_PX }, HAZARD_TAB)
    const tabRight = HAZARD_TAB.offsetLeft + HAZARD_TAB.offsetWidth - left
    expect(tabRight).toBeLessThanOrEqual(VISIBLE_WIDTH_PX - TAB_FADE_WIDTH_PX)
  })
})

/**
 * **ヘッダで伸びるものを置かない**（`docs/260828_fix_flood.md` §5）。
 *
 * 駅詳細は「ヘッダ → タブ帯 → 本文」の 3 段で、**スクロールするのは本文だけ**である。
 * 外側は高さが固定（PC は `overflow-hidden`、モバイルは vaul の `max-h-[86vh]`）なので、
 * ヘッダで伸びたぶんは**切り落とされ、スクロールしても読めない**。
 * 実際にそれで「詳しく見るの下が切れる」が起きた（実測：中身の下端 1407px 対 画面 700px）。
 *
 * 型でも lint でも防げない置き方なので、**ソースを読んで**固定する。
 */
describe('駅詳細ヘッダの不変条件（260828）', () => {
  const PANEL_SOURCE = readFileSync('src/components/detail/StationDetailPanel.tsx', 'utf-8')
  const BADGE_SOURCE = readFileSync('src/components/hazard/StationHazardBadge.tsx', 'utf-8')
  const header = PANEL_SOURCE.slice(
    PANEL_SOURCE.indexOf('<header'),
    PANEL_SOURCE.indexOf('</header>'),
  )

  it('ヘッダを切り出せている（形が変わったらこの試験ごと見直す）', () => {
    expect(header).toContain('stationCardPanel')
    expect(header.length).toBeGreaterThan(100)
  })

  it('ヘッダにパネルの束（PanelStack）を置かない＝際限なく伸びない', () => {
    expect(header).not.toContain('PanelStack')
  })

  it('ヘッダにその場で開くものを置かない（開閉は本文＝タブでやる）', () => {
    expect(header).not.toContain('aria-expanded')
  })

  it('駅周辺のプロフィールはヘッダに置かない（「概要」タブ＝本文・261001 §12-7）', () => {
    // ヘッダに要約を置く案は実測でヘッダが 53px 伸び、どのタブでも本文が 16% 狭くなった（携帯 387→324px）。
    expect(header).not.toContain('StationProfile')
    expect(header).not.toContain('useStationProfile')
  })

  it('災害バッジはパネルを描かない（1 行の入口に徹する）', () => {
    expect(BADGE_SOURCE).not.toContain('PanelRenderer')
    expect(BADGE_SOURCE).not.toContain('PanelStack')
  })
})
