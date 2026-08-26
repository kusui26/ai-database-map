'use client'

/**
 * GUI Chat Protocol の mapActions を地図へ適用する（P8b・ProtocolRenderer の地図側）。
 * selectStation は URL（?grp&r）へ＝ドロワーも開く。highlight/flyTo は地図ストア経由。
 * clearOverlays は選択とハイライトを消す。クリックUIと同じ状態経路を通す。
 *
 * ハザードの 2 つ（`docs/260824_flood.md` §6.4）もここで受ける。
 * - `setHazardLayers` … **`?hz` に書く**＝レイヤ制御のトグルと同じ経路。共有リンクにも残る
 * - `showPoint` … 駅ではない地点の印。水害は「その一点の話」なので駅選択とは別系統（§7.1）
 */

import { useCallback } from 'react'
import { type MapResponse } from '@/shared/protocol'
import { useHazardUrlState } from '@/components/map/useHazardUrlState'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useMapStore } from '@/stores/mapStore'

/** 地点を指したときのズーム（250m メッシュ 1 枚が画面に収まるくらい）。 */
const POINT_ZOOM = 15

export function useApplyMapActions(): (response: MapResponse) => void {
  const { setGrp, setRadiusM } = useMapUrlState()
  const { setLayerKeys, setOpacity } = useHazardUrlState()
  const setHighlightedGrps = useMapStore((state) => state.setHighlightedGrps)
  const setMarkedPoint = useMapStore((state) => state.setMarkedPoint)
  const requestFlyTo = useMapStore((state) => state.requestFlyTo)

  return useCallback(
    (response: MapResponse) => {
      // 駅選択がある場合、駅への flyTo は選択が担う（重複 flyTo を避ける）。
      const hasSelect = response.mapActions.some((action) => action.type === 'selectStation')
      for (const action of response.mapActions) {
        switch (action.type) {
          case 'selectStation':
            void setGrp(action.grp)
            if (action.radiusM !== undefined) void setRadiusM(action.radiusM)
            break
          case 'highlightStations':
            setHighlightedGrps(action.grps)
            break
          case 'flyTo':
            if (!hasSelect) requestFlyTo({ lon: action.lon, lat: action.lat, zoom: action.zoom })
            break
          case 'setHazardLayers':
            setLayerKeys(action.layers)
            if (action.opacity !== undefined) setOpacity(action.opacity)
            break
          case 'showPoint':
            setMarkedPoint({ lon: action.lon, lat: action.lat, labelJa: action.labelJa ?? null })
            // 駅選択があるときはそちらの flyTo に任せる（二重のカメラ操作を避ける）。
            if (!hasSelect) requestFlyTo({ lon: action.lon, lat: action.lat, zoom: POINT_ZOOM })
            break
          case 'clearOverlays':
            void setGrp(null)
            setHighlightedGrps([])
            setMarkedPoint(null)
            break
        }
      }
    },
    [
      setGrp,
      setRadiusM,
      setLayerKeys,
      setOpacity,
      setHighlightedGrps,
      setMarkedPoint,
      requestFlyTo,
    ],
  )
}
