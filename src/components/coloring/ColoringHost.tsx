'use client'

/**
 * 駅の色分けの入れ物（2026-10-11 B5c・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * URL の条件（`?color&colorIn`）で共通 API（`GET /api/stations/classes`）を引き、
 * ①地図に描く印をストアへ渡し（描くのは `MapView`）、②凡例を地図の右下に出す。
 * URL に `color` があるときだけ読み込む（`MapShell`）——初期表示に凡例と取得の部品を載せない。
 *
 * 取得し直している間（指標を替えた直後）と取得に失敗したときは、地図に印を描かない（凡例と食い違う色を残さない）。
 */

import { useEffect } from 'react'
import { coloredStations } from '@/domain/style/coloring'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { messageJaOf } from '@/lib/fetch-json'
import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { useMapStore } from '@/stores/mapStore'
import { useColoringUrlState } from '@/components/map/useColoringUrlState'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { ColoringLegend } from './ColoringLegend'
import { useStationClasses } from './useStationClasses'

/** 駅詳細のドロワー（幅＋余白）を避けるときの右端（キャンバスと同じ算出）。 */
const RIGHT_WITH_DETAIL_PX = PANEL_WIDTH_PX + PANEL_GAP_PX + PANEL_GAP_PX

export function ColoringHost() {
  const { coloring, setColoring } = useColoringUrlState()
  const { classes, isLoading, error } = useStationClasses(coloring)
  const setStationColoring = useMapStore((state) => state.setStationColoring)
  const isDesktop = useIsDesktop()
  const { grp } = useMapUrlState()

  useEffect(() => {
    if (coloring === null) {
      setStationColoring(null)
      return
    }
    const stations = classes === undefined || error !== undefined ? [] : coloredStations(classes)
    setStationColoring({ areasKey: JSON.stringify(coloring.areas), stations })
  }, [coloring, classes, error, setStationColoring])
  // 色分けを消すと（URL から外れて）この入れ物ごと外れる。地図の印もいっしょに消す。
  useEffect(() => () => setStationColoring(null), [setStationColoring])

  if (coloring === null) return null
  // 広い画面で駅詳細が開いていれば、その左に置く（ドロワーの裏に隠さない）。
  const drawerOpen = isDesktop && grp !== null
  return (
    <div
      className="absolute right-2.5 bottom-[5.5rem] z-10 transition-[right] duration-300 sm:right-3 sm:bottom-11"
      style={drawerOpen ? { right: RIGHT_WITH_DETAIL_PX } : undefined}
    >
      <ColoringLegend
        classes={classes}
        isLoading={isLoading}
        errorJa={error === undefined ? null : messageJaOf(error, '色分けを取得できませんでした')}
        initiallyOpen={isDesktop}
        onClose={() => setColoring(null)}
      />
    </div>
  )
}
