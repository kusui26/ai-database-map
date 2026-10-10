'use client'

/**
 * 範囲へ寄せる（2026-10-11 B5c）。ランキングのハイライトと駅の色分けが使う。
 *
 * MapLibre は flyTo・easeTo・jumpTo に渡した余白（padding）を地図に**残す**（次に余白を渡すまで効き続ける）。
 * fitBounds は収まりを測るとき、その残った余白に**さらに**渡した余白を足す（`cameraForBoxAndBearing`）。
 * 駅を選ぶと、左のチャットと右の駅詳細の余白（484px ずつ）で flyTo するので、その余白が残ったまま寄せると、
 * 合計が画面の幅を超えて「収まらない」と判断され、**何もしない**（"Map cannot fit within canvas…"）。
 * 駅を選んで閉じたあとのハイライト・色分けが、範囲へ寄らなかった（2026-10-11 に実ブラウザで確かめた）。
 *
 * そこで、**見た目を動かさずに**残った余白を外してから（いま画面の真ん中に見えている地点を中心に、余白 0 で置き直す）、
 * いま開いているパネルの余白で寄せる。
 */

import type maplibregl from 'maplibre-gl'

/** 寄せる動きの長さ（ms）。 */
export const FIT_DURATION_MS = 800
const NO_PADDING: maplibregl.PaddingOptions = { top: 0, right: 0, bottom: 0, left: 0 }

/** 寄せるのに使う地図の操作だけ（`maplibregl.Map` はこの形を満たす・テストは小さな偽物を渡す）。 */
export type CameraMap = {
  getContainer(): { readonly clientWidth: number; readonly clientHeight: number }
  unproject(point: [number, number]): { readonly lng: number; readonly lat: number }
  jumpTo(options: {
    readonly center: { readonly lng: number; readonly lat: number }
    readonly padding: maplibregl.PaddingOptions
  }): unknown
  fitBounds(
    bounds: maplibregl.LngLatBoundsLike,
    options: {
      readonly padding: maplibregl.PaddingOptions
      readonly maxZoom: number
      readonly duration: number
    },
  ): unknown
}

/** 範囲 [[西, 南], [東, 北]] へ、開いているパネルを避けて寄せる。 */
export function fitBoundsInView(
  map: CameraMap,
  bounds: maplibregl.LngLatBoundsLike,
  padding: maplibregl.PaddingOptions,
  maxZoom: number,
): void {
  const { clientWidth, clientHeight } = map.getContainer()
  const center = map.unproject([clientWidth / 2, clientHeight / 2])
  map.jumpTo({ center, padding: NO_PADDING })
  map.fitBounds(bounds, { padding, maxZoom, duration: FIT_DURATION_MS })
}
