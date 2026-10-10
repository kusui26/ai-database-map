'use client'

/**
 * GUI Chat Protocol の mapActions を地図へ適用する（P8b・ProtocolRenderer の地図側）。
 * selectStation は URL（?grp&r）へ＝ドロワーも開く。highlight/flyTo は地図ストア経由。
 * clearOverlays は選択とハイライトを消す。クリックUIと同じ状態経路を通す。
 *
 * ハザードの 2 つ（`docs/260824_flood.md` §6.4）もここで受ける。
 * - `setHazardLayers` … **`?hz` に書く**＝レイヤ制御のトグルと同じ経路。共有リンクにも残る
 * - `showPoint` … 駅ではない地点の印。水害は「その一点の話」なので駅選択とは別系統（§7.1）
 * - `highlightPoints` … **行き先**の印（避難先・§8.5）。起点（`showPoint`）とは別の印にする
 *
 * 駅の色分け（`colorStations`・2026-10-11 B5c）は **`?color&colorIn` に書く**＝凡例の ✕ と同じ経路で、共有リンクにも残る。
 * 回答が色分けを送らなければ前の色分けは残り（ハザードと同じ）、`clearOverlays` は色分けも消す。
 *
 * URL を書く操作の履歴は、その回答の約束に従う（`answerHistory.ts`）——最初に書くなら push、
 * 送り直しは replace、回答の途中で「戻る／進む」を押されたら書かない（2026-10-02）。
 *
 * 携帯でチャットを開いているときの `selectStation` は、駅を選ぶが詳細のシートは開かない
 * （`?sheet=closed`）。シートがチャットを覆って回答が読めなくなるため。駅詳細は会話の中に出す（A4）。
 */

import { useCallback } from 'react'
import { type MapAction, type MapResponse } from '@/shared/protocol'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useHazardUrlState } from '@/components/map/useHazardUrlState'
import { useColoringUrlState } from '@/components/map/useColoringUrlState'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useChatStore } from '@/stores/chatStore'
import { useMapStore } from '@/stores/mapStore'
import { type AnswerHistory } from './answerHistory'

/** 地点を指したときのズーム（250m メッシュ 1 枚が画面に収まるくらい）。 */
const POINT_ZOOM = 15

/** URL を書く操作（ほかは地図ストアだけを動かす）。 */
const URL_ACTION_TYPES: ReadonlySet<MapAction['type']> = new Set([
  'selectStation',
  'setHazardLayers',
  'colorStations',
  'clearOverlays',
])

/** この応答が URL を書くか（書くときだけ、その回答の履歴の約束を使う）。 */
export function writesUrl(response: MapResponse): boolean {
  return response.mapActions.some((action) => URL_ACTION_TYPES.has(action.type))
}

/** 応答の地図操作を当てる。URL を書く操作は、その回答の履歴の約束に従う。 */
export type MapActionsApplier = (response: MapResponse, answerHistory: AnswerHistory) => void

export function useApplyMapActions(): MapActionsApplier {
  const { setGrp, setRadiusM, keepSheetClosed } = useMapUrlState()
  const isDesktop = useIsDesktop()
  const chatOpen = useChatStore((state) => state.open)
  // 携帯でチャットのシートが開いている＝駅詳細のシートを開くと回答を覆う。
  const sheetWouldCoverChat = !isDesktop && chatOpen
  const { setLayerKeys, setOpacity } = useHazardUrlState()
  const { setColoring } = useColoringUrlState()
  const setHighlightedGrps = useMapStore((state) => state.setHighlightedGrps)
  const setMarkedPoint = useMapStore((state) => state.setMarkedPoint)
  const setHighlightedPoints = useMapStore((state) => state.setHighlightedPoints)
  const requestFlyTo = useMapStore((state) => state.requestFlyTo)

  return useCallback(
    (response: MapResponse, answerHistory: AnswerHistory) => {
      const history = writesUrl(response) ? answerHistory.take() : null
      // 駅選択がある場合、駅への flyTo は選択が担う（重複 flyTo を避ける）。
      const hasSelect = response.mapActions.some((action) => action.type === 'selectStation')
      for (const action of response.mapActions) {
        switch (action.type) {
          case 'selectStation':
            if (history === null) break
            void setGrp(action.grp, { history })
            if (action.radiusM !== undefined) void setRadiusM(action.radiusM, { history })
            if (sheetWouldCoverChat) void keepSheetClosed({ history })
            break
          case 'highlightStations':
            setHighlightedGrps(action.grps)
            break
          case 'flyTo':
            if (!hasSelect) requestFlyTo({ lon: action.lon, lat: action.lat, zoom: action.zoom })
            break
          case 'setHazardLayers':
            if (history === null) break
            setLayerKeys(action.layers, history)
            if (action.opacity !== undefined) setOpacity(action.opacity, history)
            break
          case 'showPoint':
            setMarkedPoint({ lon: action.lon, lat: action.lat, labelJa: action.labelJa ?? null })
            // 駅選択があるときはそちらの flyTo に任せる（二重のカメラ操作を避ける）。
            if (!hasSelect) requestFlyTo({ lon: action.lon, lat: action.lat, zoom: POINT_ZOOM })
            break
          case 'highlightPoints':
            setHighlightedPoints(action.points)
            break
          case 'colorStations':
            if (history === null) break
            setColoring(
              action.metricKey === null
                ? null
                : { metricKey: action.metricKey, areas: action.areas },
              history,
            )
            break
          case 'clearOverlays':
            if (history !== null) {
              void setGrp(null, { history })
              setColoring(null, history)
            }
            setHighlightedGrps([])
            setMarkedPoint(null)
            setHighlightedPoints([])
            break
        }
      }
    },
    [
      setGrp,
      setRadiusM,
      keepSheetClosed,
      sheetWouldCoverChat,
      setLayerKeys,
      setOpacity,
      setColoring,
      setHighlightedGrps,
      setMarkedPoint,
      setHighlightedPoints,
      requestFlyTo,
    ],
  )
}
