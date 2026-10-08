/**
 * 地図の表示範囲（2026-10-08 L3・`src/shared/viewport.ts`）：丸め・検証・送信の形・地図の状態。
 *
 * チャットの送信に同送し、同じ名前の路線（「中央線」＝JR・大阪メトロ）を決めるのに使う。丸めは**外向き**
 * （見えている範囲を必ず含む）。1px 動かすたびに値が変わらないこと・壊れた値を範囲として使わないことを固定する。
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  isValidViewport,
  roundViewport,
  sameViewport,
  viewportFromTuple,
  viewportToTuple,
  type Viewport,
} from '@/shared/viewport'
import { useMapStore } from '@/stores/mapStore'
import { chatBody } from '@/components/chat/sendContext'

const TOKYO: Viewport = { west: 138.78, south: 35.21, east: 140.76, north: 36.15 }

describe('roundViewport（外向きに小数 2 桁）', () => {
  it('西・南は切り捨て、東・北は切り上げ（見えている範囲を必ず含む）', () => {
    expect(
      roundViewport({ west: 138.7861, south: 35.2149, east: 140.7612, north: 36.1401 }),
    ).toEqual({ west: 138.78, south: 35.21, east: 140.77, north: 36.15 })
  })

  it('浮動小数の端数を残さない（0.1 + 0.2 のような値にしない）', () => {
    const rounded = roundViewport({ west: 0.1 + 0.2, south: 1.005, east: 2.675, north: 3.3 })
    expect(rounded).toEqual({ west: 0.3, south: 1, east: 2.68, north: 3.3 })
  })

  it('世界の複製が見えるほど引いても、経度・緯度の範囲で止める', () => {
    expect(roundViewport({ west: -200.5, south: -89.99, east: 213.2, north: 90 })).toEqual({
      west: -180,
      south: -89.99,
      east: 180,
      north: 90,
    })
  })

  it('同じ範囲なら同じ値（動かしていない＝送る値も変わらない）', () => {
    const a = roundViewport({ west: 138.7801, south: 35.2101, east: 140.7599, north: 36.1499 })
    const b = roundViewport({ west: 138.7899, south: 35.2199, east: 140.7501, north: 36.1401 })
    expect(sameViewport(a, b)).toBe(true)
  })
})

describe('isValidViewport・viewportFromTuple（壊れた値を範囲として使わない）', () => {
  it.each([
    ['正しい範囲', [138.78, 35.21, 140.76, 36.15], true],
    ['3 値', [138.78, 35.21, 140.76], false],
    ['5 値', [138.78, 35.21, 140.76, 36.15, 1], false],
    ['西と東が逆', [140.76, 35.21, 138.78, 36.15], false],
    ['南と北が同じ', [138.78, 35.21, 140.76, 35.21], false],
    ['経度が範囲の外', [-181, 35.21, 140.76, 36.15], false],
    ['緯度が範囲の外', [138.78, -91, 140.76, 36.15], false],
    ['無限大', [138.78, 35.21, Number.POSITIVE_INFINITY, 36.15], false],
    ['NaN', [Number.NaN, 35.21, 140.76, 36.15], false],
  ])('%s → %s', (_label, values, valid) => {
    expect(viewportFromTuple(values) !== null).toBe(valid)
  })

  it('[west, south, east, north] で往復する（ツールの bbox と同じ並び）', () => {
    expect(viewportFromTuple(viewportToTuple(TOKYO))).toEqual(TOKYO)
    expect(isValidViewport(TOKYO)).toBe(true)
  })
})

describe('mapStore.setViewport（丸めて持つ・変わらなければ描き直さない）', () => {
  afterEach(() => {
    useMapStore.setState({ viewport: null })
  })

  it('丸めて持ち、丸めた値が同じなら状態を差し替えない', () => {
    const store = useMapStore.getState()
    store.setViewport({ west: 138.7861, south: 35.2149, east: 140.7512, north: 36.1401 })
    const first = useMapStore.getState().viewport
    expect(first).toEqual({ west: 138.78, south: 35.21, east: 140.76, north: 36.15 })
    store.setViewport({ west: 138.7899, south: 35.2101, east: 140.7599, north: 36.1499 })
    expect(useMapStore.getState().viewport).toBe(first)
  })
})

describe('chatBody（送信に同送する地図の文脈）', () => {
  it('何も無ければ送らない（以前の送信と同じ形）', () => {
    expect(chatBody(null, 1000, null)).toBeUndefined()
  })

  it('表示範囲は [west, south, east, north] の bbox で送る', () => {
    expect(chatBody(null, 1000, TOKYO)).toEqual({ body: { bbox: [138.78, 35.21, 140.76, 36.15] } })
  })

  it('選択中の駅と表示範囲は一緒に送る', () => {
    expect(chatBody('東京#0', 2000, TOKYO)).toEqual({
      body: { selectedGrp: '東京#0', radiusM: 2000, bbox: [138.78, 35.21, 140.76, 36.15] },
    })
  })
})
