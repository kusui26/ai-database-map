/**
 * 寄せるときの余白（`src/components/map/padding.ts`）と、エリアの図の列の横に地図の凡例を置けるか
 * （`ColoringHost.tsx` の `minWidthForLegendBesideColumn`）——2026-10-15 B5e。
 *
 * 広い画面でエリアの図を開くと、チャットの右に列（420px）が並ぶ。色分けしたエリアの駅が列の裏に入らないように、寄せる余白は
 * 列も避ける。ただし列も避けると見える幅が残らないとき（駅詳細も開いた 1128〜1400px）は列を避けない——MapLibre は余白の和が
 * 地図より広いと寄せない（"Map cannot fit within canvas"・B5c で実ブラウザで確かめた失敗）。
 * 以前の余白（チャット・駅詳細だけ）は変えない。
 */

import { describe, expect, it } from 'vitest'
import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { AREA_COLUMN_WIDTH_PX } from '@/hooks/useIsWide'
import { BASE_PAD_PX, flyPadding, type OpenPanels } from '@/components/map/padding'
import { MIN_VISIBLE_WIDTH_PX } from '@/components/map/visibleBounds'
import { minWidthForLegendBesideColumn } from '@/components/coloring/ColoringHost'

const CLOSED: OpenPanels = {
  isDesktop: true,
  chatOpen: false,
  drawerOpen: false,
  areaColumnOpen: false,
}

describe('flyPadding（寄せる余白）', () => {
  it('以前と同じ：チャットは左、駅詳細は右に、パネル幅＋64px', () => {
    expect(flyPadding({ ...CLOSED, chatOpen: true, drawerOpen: true }, 1440)).toEqual({
      top: BASE_PAD_PX,
      bottom: BASE_PAD_PX,
      left: PANEL_WIDTH_PX + BASE_PAD_PX,
      right: PANEL_WIDTH_PX + BASE_PAD_PX,
    })
    expect(flyPadding(CLOSED, 1440)).toMatchObject({ left: BASE_PAD_PX, right: BASE_PAD_PX })
  })

  it('携帯はパネルを横に並べないので、開いていても 64px', () => {
    const phone = { ...CLOSED, isDesktop: false, chatOpen: true, drawerOpen: true }
    expect(flyPadding(phone, 390)).toMatchObject({ left: BASE_PAD_PX, right: BASE_PAD_PX })
  })

  it('エリアの図の列を開いていれば、列も避ける（チャットの右に並ぶ）', () => {
    const column = PANEL_GAP_PX + AREA_COLUMN_WIDTH_PX
    expect(flyPadding({ ...CLOSED, chatOpen: true, areaColumnOpen: true }, 1440).left).toBe(
      PANEL_WIDTH_PX + BASE_PAD_PX + column,
    )
    expect(flyPadding({ ...CLOSED, areaColumnOpen: true }, 1440).left).toBe(BASE_PAD_PX + column)
  })

  it('列を避けると、列の右端より先から寄せる（1440px：列は 444〜864px・余白は 916px）', () => {
    const padding = flyPadding({ ...CLOSED, chatOpen: true, areaColumnOpen: true }, 1440)
    const columnRight = PANEL_GAP_PX + PANEL_WIDTH_PX + PANEL_GAP_PX + AREA_COLUMN_WIDTH_PX
    expect(columnRight).toBe(864)
    expect(padding.left).toBeGreaterThan(columnRight)
  })

  it('列も避けると見える幅が残らないなら、列は避けない（駅詳細も開いた 1280px）', () => {
    const crowded = { ...CLOSED, chatOpen: true, drawerOpen: true, areaColumnOpen: true }
    const padding = flyPadding(crowded, 1280)
    expect(padding.left).toBe(PANEL_WIDTH_PX + BASE_PAD_PX)
    expect(1280 - padding.left - padding.right).toBeGreaterThanOrEqual(MIN_VISIBLE_WIDTH_PX)
  })

  it('境目：見える幅がちょうど 160px なら列を避ける', () => {
    const open = { ...CLOSED, chatOpen: true, drawerOpen: true, areaColumnOpen: true }
    const column = PANEL_GAP_PX + AREA_COLUMN_WIDTH_PX
    const width = 2 * (PANEL_WIDTH_PX + BASE_PAD_PX) + column + MIN_VISIBLE_WIDTH_PX
    expect(flyPadding(open, width).left).toBe(PANEL_WIDTH_PX + BASE_PAD_PX + column)
    expect(flyPadding(open, width - 1).left).toBe(PANEL_WIDTH_PX + BASE_PAD_PX)
  })
})

describe('minWidthForLegendBesideColumn（列の右に凡例を置ける最小の画面幅）', () => {
  it('チャットを開き、駅詳細を閉じている：1176px（列の右端 864＋余白＋凡例 288＋右の余白）', () => {
    expect(minWidthForLegendBesideColumn(true, false)).toBe(864 + 12 + 288 + 12)
  })

  it('駅詳細も開いている：1608px（1440px では凡例を出さない＝列の下に隠さない）', () => {
    expect(minWidthForLegendBesideColumn(true, true)).toBe(1608)
    expect(minWidthForLegendBesideColumn(true, true)).toBeGreaterThan(1440)
  })

  it('チャットを閉じている：列は左端から', () => {
    expect(minWidthForLegendBesideColumn(false, false)).toBe(12 + 420 + 12 + 288 + 12)
  })
})
