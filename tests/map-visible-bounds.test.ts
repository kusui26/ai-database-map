/**
 * 地図のうち、パネルに隠れていない部分の範囲（`src/components/map/visibleBounds.ts`・2026-10-09 B3）。
 *
 * チャットに同送する「地図の表示範囲」は、以前は地図全体だった。広い画面では左のチャット欄と右の駅詳細が地図を覆うので、
 * 「このあたり」に見えていない駅が入っていた。ここでは、覆われる幅・見えている矩形の 4 隅・経度緯度の範囲の求め方を固定する。
 */

import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  mapInsets,
  MIN_VISIBLE_WIDTH_PX,
  visibleCorners,
} from '@/components/map/visibleBounds'
import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'

const SIDE = PANEL_GAP_PX + PANEL_WIDTH_PX

describe('mapInsets（パネルに覆われる幅）', () => {
  it('広い画面：チャット欄は左、駅詳細は右を覆う（余白＋パネル幅＝432px）', () => {
    expect(SIDE).toBe(432)
    expect(mapInsets(true, true, false)).toEqual({ left: SIDE, right: 0 })
    expect(mapInsets(true, false, true)).toEqual({ left: 0, right: SIDE })
    expect(mapInsets(true, true, true)).toEqual({ left: SIDE, right: SIDE })
  })

  it('モバイルのパネルは地図の上に横から重ねないので、覆う幅は 0', () => {
    expect(mapInsets(false, true, true)).toEqual({ left: 0, right: 0 })
  })
})

describe('visibleCorners（見えている矩形の 4 隅）', () => {
  it('チャット欄を開いた 1440px の地図は、左の 432px を除く', () => {
    expect(visibleCorners(1440, 840, mapInsets(true, true, false))).toEqual([
      [432, 0],
      [1440, 0],
      [432, 840],
      [1440, 840],
    ])
  })

  it('両側を開くと、あいだだけ', () => {
    expect(visibleCorners(1440, 840, mapInsets(true, true, true))).toEqual([
      [432, 0],
      [1008, 0],
      [432, 840],
      [1008, 840],
    ])
  })

  it('覆われていない幅が狭すぎれば（160px 未満）、地図全体にする', () => {
    expect(MIN_VISIBLE_WIDTH_PX).toBe(160)
    // 1023px の窓で両側を開く：見える幅は 159px
    expect(visibleCorners(1023, 700, mapInsets(true, true, true))[1]).toEqual([1023, 0])
    // 1024px なら 160px が見える＝その幅で
    expect(visibleCorners(1024, 700, mapInsets(true, true, true))[1]).toEqual([592, 0])
  })

  it('パネルが無ければ地図全体', () => {
    expect(visibleCorners(390, 844, mapInsets(false, true, false))).toEqual([
      [0, 0],
      [390, 0],
      [0, 844],
      [390, 844],
    ])
  })
})

describe('boundsOf（経度・緯度の範囲）', () => {
  it('4 隅を囲む（地図が回っていても、どの隅も外さない）', () => {
    expect(
      boundsOf([
        { lng: 139.71, lat: 35.7 },
        { lng: 139.8, lat: 35.71 },
        { lng: 139.7, lat: 35.64 },
        { lng: 139.79, lat: 35.65 },
      ]),
    ).toEqual({ west: 139.7, south: 35.64, east: 139.8, north: 35.71 })
  })
})
