'use client'

/**
 * 駅の色分けの入れ物（2026-10-11 B5c・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * URL の条件（`?color&colorIn`）で共通 API（`GET /api/stations/classes`）を引き、
 * ①地図に描く印をストアへ渡し（描くのは `MapView`）、②凡例を地図の右下に出す。
 * URL に `color` があるときだけ読み込む（`MapShell`）——初期表示に凡例と取得の部品を載せない。
 *
 * 取得し直している間（指標を替えた直後）と取得に失敗したときは、地図に印を描かない（凡例と食い違う色を残さない）。
 *
 * 広い画面でエリアの図の列を開いていて、凡例が列の右に入らない幅なら（駅詳細も開いた 1440px など）凡例を出さない
 * （2026-10-15 B5e）——重ねると列の下に隠れる。そのときは列のエリアの要約が同じ凡例を出す。判定は `legendPlacement.ts`
 * の 1 か所（列の要約も同じものを読む）。地図の印はそのまま描く。
 */

import { useEffect } from 'react'
import { coloredStations } from '@/domain/style/coloring'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { messageJaOf } from '@/lib/fetch-json'
import { useMapStore } from '@/stores/mapStore'
import { useColoringUrlState } from '@/components/map/useColoringUrlState'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { ColoringLegend } from './ColoringLegend'
import { RIGHT_WITH_DETAIL_PX, useMapLegendHiddenByColumn } from './legendPlacement'
import { useStationClasses } from './useStationClasses'

export function ColoringHost() {
  const { coloring, setColoring } = useColoringUrlState()
  const { classes, isLoading, error } = useStationClasses(coloring)
  const setStationColoring = useMapStore((state) => state.setStationColoring)
  const isDesktop = useIsDesktop()
  const { grp } = useMapUrlState()
  const hiddenByColumn = useMapLegendHiddenByColumn()

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

  if (coloring === null || hiddenByColumn) return null
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
