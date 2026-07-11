'use client'

/**
 * GUI Chat Protocol の mapActions を地図へ適用する（P8b・ProtocolRenderer の地図側）。
 * selectStation は URL（?grp&r）へ＝ドロワーも開く。highlight/flyTo は地図ストア経由。
 * clearOverlays は選択とハイライトを消す。クリックUIと同じ状態経路を通す。
 */

import { useCallback } from 'react'
import { type MapResponse } from '@/shared/protocol'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useMapStore } from '@/stores/mapStore'

export function useApplyMapActions(): (response: MapResponse) => void {
  const { setGrp, setRadiusM } = useMapUrlState()
  const setHighlightedGrps = useMapStore((state) => state.setHighlightedGrps)
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
          case 'clearOverlays':
            void setGrp(null)
            setHighlightedGrps([])
            break
        }
      }
    },
    [setGrp, setRadiusM, setHighlightedGrps, requestFlyTo],
  )
}
