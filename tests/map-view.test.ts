/**
 * 地図の表示範囲を LLM に伝える形（`src/ai/area/map-view.ts`・`mapViewPrompt`・2026-10-09 B3）。
 *
 * 「このあたりで地価が上がっている駅は？」の「このあたり」は、送信時に地図に表示している範囲。ここで固定するのは：
 *
 * - LLM に見せるのは**広さと中心に近い駅（その市区町村）だけ**。範囲の数（経度・緯度）は見せない——絞るのは
 *   ツールの `inMapView` で、範囲はサーバが持っている
 * - 日本全体に近いほど広い地図では「このあたり」がどこか決まらない（使わずに聞き返させる）
 * - 「この区」「この市」は、区や市が画面の主役になるほど寄っているときだけ、中心の駅の市区町村と読ませる
 * - 中心が海・山の上なら、遠い駅を中心の駅として挙げない
 */

import { describe, expect, it } from 'vitest'
import {
  describeMapView,
  isTooWideForArea,
  MAP_CENTER_STATION_MAX_M,
  MAP_VIEW_MAX_LAT_SPAN_DEG,
  MAP_VIEW_MAX_LON_SPAN_DEG,
  MAP_WARD_MAX_SPAN_KM,
} from '@/ai/area/map-view'
import { buildAreaIndex } from '@/ai/area/place-index'
import { mapViewPrompt } from '@/ai/system-prompt'
import { type Viewport } from '@/shared/viewport'
import { AREA_STATIONS, TOKYO_VIEW } from './fixtures/area-catalog'

const INDEX = buildAreaIndex(AREA_STATIONS)

/** 竹橋の周り（約 7km 四方・中心は竹橋の 200m ほど南西）。 */
const TAKEBASHI_VIEW: Viewport = { west: 139.72, south: 35.66, east: 139.8, north: 35.72 }
/** 東京湾の上（中心から 5km 以内に駅が無い）。 */
const BAY_VIEW: Viewport = { west: 139.75, south: 35.45, east: 139.95, north: 35.6 }
/** 日本全体。 */
const JAPAN_VIEW: Viewport = { west: 122.9, south: 24.0, east: 153.9, north: 45.6 }

describe('isTooWideForArea（「このあたり」と言える広さか）', () => {
  it('首都圏の初期表示（約 2°×0.9°）は使える。日本全体は使えない', () => {
    expect(isTooWideForArea(TOKYO_VIEW)).toBe(false)
    expect(isTooWideForArea(JAPAN_VIEW)).toBe(true)
  })

  it.each([
    ['経度の幅がちょうど上限', MAP_VIEW_MAX_LON_SPAN_DEG, 1, false],
    ['経度の幅が上限を超える', MAP_VIEW_MAX_LON_SPAN_DEG + 0.01, 1, true],
    ['緯度の幅がちょうど上限', 1, MAP_VIEW_MAX_LAT_SPAN_DEG, false],
    ['緯度の幅が上限を超える', 1, MAP_VIEW_MAX_LAT_SPAN_DEG + 0.01, true],
  ])('%s → %s', (_label, lonSpan, latSpan, tooWide) => {
    const view = { west: 135, south: 34, east: 135 + lonSpan, north: 34 + latSpan }
    expect(isTooWideForArea(view)).toBe(tooWide)
  })
})

describe('describeMapView（地図の様子）', () => {
  it('広さは km（竹橋の周り＝約 7.2km × 6.7km）', () => {
    const view = describeMapView(TAKEBASHI_VIEW, INDEX)
    expect(view.widthKm).toBeCloseTo(7.24, 1)
    expect(view.heightKm).toBeCloseTo(6.67, 1)
    expect(view.tooWide).toBe(false)
  })

  it('中心に最も近い駅（とその市区町村）を挙げる', () => {
    expect(describeMapView(TAKEBASHI_VIEW, INDEX).center).toEqual({
      name: '竹橋',
      prefecture: '東京都',
      municipality: '千代田区',
      distanceM: expect.any(Number),
    })
    // 同じ名前の駅も駅名で挙げる（区別は都道府県・市区町村がつける）
    const fuchu = describeMapView({ west: 139.45, south: 35.65, east: 139.51, north: 35.69 }, INDEX)
    expect(fuchu.center).toMatchObject({
      name: '府中',
      prefecture: '東京都',
      municipality: '府中市',
    })
  })

  it('中心から 5km 以内に駅が無ければ挙げない（東京湾の上）', () => {
    expect(describeMapView(BAY_VIEW, INDEX).center).toBeNull()
    expect(MAP_CENTER_STATION_MAX_M).toBe(5000)
  })

  it('日本全体に近い広さなら「広すぎる」。中心の駅も挙げない', () => {
    const view = describeMapView(JAPAN_VIEW, INDEX)
    expect(view.tooWide).toBe(true)
    expect(view.center).toBeNull()
  })

  it('索引が無くても広さだけは伝える（中心の駅を挙げないだけ）', () => {
    const view = describeMapView(TAKEBASHI_VIEW, null)
    expect(view.center).toBeNull()
    expect(view.widthKm).toBeGreaterThan(7)
  })

  it('「この区」と読めるのは、縦横の長い方が 50km までのとき', () => {
    expect(describeMapView(TAKEBASHI_VIEW, INDEX).wardScale).toBe(true)
    expect(describeMapView(TOKYO_VIEW, INDEX).wardScale).toBe(false)
    expect(MAP_WARD_MAX_SPAN_KM).toBe(50)
  })
})

describe('mapViewPrompt（LLM に足す文脈）', () => {
  it('広さと中心の駅を書き、「このあたり」は inMapView で絞らせる（範囲の数は書かない）', () => {
    const prompt = mapViewPrompt(describeMapView(TAKEBASHI_VIEW, INDEX))
    expect(prompt).toContain('# 地図の表示範囲（「このあたり」）')
    expect(prompt).toContain(
      '約 7.2km × 6.7km の範囲を表示しています（中心に近い駅は 竹橋（東京都千代田区））',
    )
    expect(prompt).toContain('inMapView:true')
    expect(prompt).toContain('bbox に数を書かない')
    expect(prompt).toContain('頼まれていないのに地図の範囲で絞らない')
    // 経度・緯度の数は見せない
    expect(prompt).not.toMatch(/139\.\d|35\.\d/u)
  })

  it('寄っていれば「この区」を中心の駅の市区町村（都道府県つき）で読ませる', () => {
    const prompt = mapViewPrompt(describeMapView(TAKEBASHI_VIEW, INDEX))
    expect(prompt).toContain('municipality:"千代田区"・prefectures:["東京都"]')
  })

  it('「この区」は地図の範囲ではないと言い切り、inMapView を付けさせない（2026-10-09 B4）', () => {
    // 「（地図の範囲では絞らない）」だけでは境目に近く、システムプロンプトに節を足しただけで地図の範囲で答えた（6 回中 0 回が区）
    const prompt = mapViewPrompt(describeMapView(TAKEBASHI_VIEW, INDEX))
    expect(prompt).toContain('「この区」「この市」「この町」は**地図の範囲ではない**')
    expect(prompt).toContain('**inMapView は付けない**')
  })

  it('首都圏の初期表示（約 179km）では「この区」を読ませない。広さは整数の km', () => {
    const prompt = mapViewPrompt(describeMapView(TOKYO_VIEW, INDEX))
    expect(prompt).toContain('約 179km × 105km')
    expect(prompt).toContain('中心に近い駅は 東京（東京都千代田区）')
    expect(prompt).not.toContain('この区')
    expect(prompt).toContain('inMapView:true')
  })

  it('中心の近くに駅が無ければ、そう書く（「この区」も読ませない）', () => {
    const prompt = mapViewPrompt(describeMapView(BAY_VIEW, INDEX))
    expect(prompt).toContain('中心の近くに駅はありません')
    expect(prompt).not.toContain('この区')
  })

  it('索引が読めず中心を調べていなければ、駅が無いとは書かない（広さだけ）', () => {
    const view = describeMapView(TAKEBASHI_VIEW, null)
    expect(view.centerSearched).toBe(false)
    const prompt = mapViewPrompt(view)
    expect(prompt).toContain('利用者の地図は、いま 約 7.2km × 6.7km の範囲を表示しています。')
    expect(prompt).not.toContain('駅はありません')
    expect(prompt).not.toContain('この区')
  })

  it('日本全体に近い広さなら、inMapView を使わせず聞き返させる', () => {
    const prompt = mapViewPrompt(describeMapView(JAPAN_VIEW, INDEX))
    expect(prompt).toContain('日本全体に近い広さ（約 2831km × 2402km）')
    expect(prompt).toContain('inMapView は使わず、どのあたりかを利用者に聞く')
    expect(prompt).not.toContain('inMapView:true')
  })
})
