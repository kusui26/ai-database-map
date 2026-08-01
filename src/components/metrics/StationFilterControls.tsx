'use client'

/**
 * 絞り込みの 3 セレクタ（都道府県・運営会社・路線）を 1 かたまりで描く（260801）。
 *
 * 散布とランキングが**同じ並び・同じ連動**で使う。並べる順は
 * 「どこを → どの会社を → どの路線を」＝広い条件から狭い条件へ。
 * 状態と連動は `useStationFilters` が持ち、ここは描画だけを担う。
 */

import { type StationFiltersState } from './useStationFilters'
import { OperatorMultiSelect } from './OperatorMultiSelect'
import { PrefectureMultiSelect } from './PrefectureMultiSelect'
import { RouteMultiSelect } from './RouteMultiSelect'

export function StationFilterControls({ state }: { state: StationFiltersState }) {
  return (
    <>
      <PrefectureMultiSelect
        selected={[...state.values.prefectures]}
        onChange={state.setPrefectures}
        allowed={state.allowedPrefectures}
      />
      <OperatorMultiSelect
        selected={[...state.values.operators]}
        onChange={state.setOperators}
        operators={state.operatorList}
        isLoading={state.operatorsLoading}
        error={state.operatorsError}
        allowed={state.allowedOperators}
        allowedScope={state.operatorScope}
        onApplyPrefectures={state.applyOperatorPrefectures}
        applyPrefectureCount={state.applyPrefectureCount}
      />
      <RouteMultiSelect
        selected={[...state.values.routes]}
        selectedTypes={[...state.values.routeTypes]}
        onChange={state.setRoutes}
        onChangeTypes={state.setRouteTypes}
        routes={state.routeList}
        isLoading={state.routesLoading}
        error={state.routesError}
        allowed={state.allowedRoutes}
      />
    </>
  )
}
