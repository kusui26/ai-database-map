/**
 * 範囲へ寄せる（`src/components/map/camera.ts`・2026-10-11 B5c）。
 *
 * MapLibre は flyTo に渡した余白を地図に残し、fitBounds はそれに渡した余白を足して収まりを測る。駅を選んだときの余白
 * （左右 484px ずつ）が残ったまま寄せると「収まらない」と判断されて何もしない——駅を選んで閉じたあとのハイライト・
 * 色分けが寄らなかった（実ブラウザ `tests/ui.station-coloring.smoke.py` の 7′ が、直す前のビルドで落ちる）。
 *
 * 見ること：①先に、いま画面の真ん中に見えている地点を中心に**余白 0** で置き直す（見た目は動かない）②そのあと、
 * いま開いているパネルの余白で寄せる（順番が逆だと、残った余白のまま測ってしまう）。
 */

import { describe, expect, it } from 'vitest'
import { FIT_DURATION_MS, fitBoundsInView, type CameraMap } from '@/components/map/camera'

type Call =
  | { readonly kind: 'jumpTo'; readonly options: Parameters<CameraMap['jumpTo']>[0] }
  | {
      readonly kind: 'fitBounds'
      readonly bounds: Parameters<CameraMap['fitBounds']>[0]
      readonly options: Parameters<CameraMap['fitBounds']>[1]
    }

/** 1440×900 の地図。画面の点 → 地点は、点をそのまま返す（どの点を測ったかを見るため）。 */
function fakeMap(): { readonly map: CameraMap; readonly calls: Call[] } {
  const calls: Call[] = []
  const map: CameraMap = {
    getContainer: () => ({ clientWidth: 1440, clientHeight: 900 }),
    unproject: ([x, y]) => ({ lng: x, lat: y }),
    jumpTo: (options) => calls.push({ kind: 'jumpTo', options }),
    fitBounds: (bounds, options) => calls.push({ kind: 'fitBounds', bounds, options }),
  }
  return { map, calls }
}

const BOUNDS: [[number, number], [number, number]] = [
  [139.48, 35.32],
  [139.7, 35.58],
]
const PANELS = { top: 64, bottom: 64, left: 484, right: 64 }

describe('範囲へ寄せる（残った余白で寄せ損ねない）', () => {
  it('先に、画面の真ん中に見えている地点を中心に余白 0 で置き直し、そのあとパネルの余白で寄せる', () => {
    const { map, calls } = fakeMap()
    fitBoundsInView(map, BOUNDS, PANELS, 13)
    expect(calls).toEqual([
      {
        kind: 'jumpTo',
        options: {
          center: { lng: 720, lat: 450 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      },
      {
        kind: 'fitBounds',
        bounds: BOUNDS,
        options: { padding: PANELS, maxZoom: 13, duration: FIT_DURATION_MS },
      },
    ])
  })
})
