'use client'

/**
 * 絞り込みのセレクタ（都道府県・市区町村・運営会社・路線＋詳しい条件）を 1 かたまりで描く（260801）。
 *
 * 散布・ランキング・おすすめが**同じ並び・同じ連動**で使う。並べる順は
 * 「どこを → どの会社を → どの路線を」＝広い条件から狭い条件へ。
 * 状態と連動は `useStationFilters` が持ち、ここは描画だけを担う。
 *
 * 2026-10-08 B2：市区町村は都道府県の隣（都道府県を 1 つ選んだときに選べる）。起点から N km・地図の範囲は
 * チャットの図の ⤢ からだけ入るので、外せるチップで最後に出す（`AreaChips`）。
 *
 * 2026-10-08 L4：「路線」は運行系統（利用者が呼ぶ路線・`LineMultiSelect`）。法令上の路線と事業者種別は
 * 「詳しい条件」の中に置く（以前の URL の互換・鉄道に詳しい人向け）。詳しい条件が効いているときは、
 * 開いて始め、閉じても件数をボタンに出す（見えない条件にしない）。
 */

import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { type StationFiltersState } from './useStationFilters'
import { AreaChips } from './AreaChips'
import { LineMultiSelect } from './LineMultiSelect'
import { MunicipalitySelect } from './MunicipalitySelect'
import { OperatorMultiSelect } from './OperatorMultiSelect'
import { PrefectureMultiSelect } from './PrefectureMultiSelect'
import { RouteMultiSelect } from './RouteMultiSelect'

/** 詳しい条件（法令上の路線・事業者種別）の指定の数。 */
function detailCount(state: StationFiltersState): number {
  return state.values.routes.length + state.values.routeTypes.length
}

function DetailToggle({
  open,
  count,
  controls,
  onToggle,
}: {
  open: boolean
  count: number
  controls: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      className={cn(
        'flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors',
        count > 0 ? 'font-medium text-indigo-700' : 'text-slate-500',
        'hover:bg-slate-100',
      )}
    >
      詳しい条件{count > 0 ? `（${count}）` : ''}
      <svg
        viewBox="0 0 24 24"
        className={cn('size-3.5 transition-transform', open && 'rotate-180')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

/** 詳しい条件の中身：法令上の路線（種別のチップは、このセレクタの中）。 */
function DetailConditions({ id, state }: { id: string; state: StationFiltersState }) {
  return (
    <div id={id} role="group" aria-label="詳しい条件" className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500">法令上の路線</span>
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
    </div>
  )
}

/** 場所のチップ（起点・範囲と、選択の部品で出せない市区町村）。 */
function AreaChipsOf({
  state,
  originLabel,
}: {
  state: StationFiltersState
  originLabel: string | null
}) {
  const { area } = state
  const muniChip =
    area.singlePrefecture === null && area.municipality !== '' ? area.municipality : null
  return (
    <AreaChips
      near={area.near}
      originLabel={originLabel}
      hasBbox={area.bbox !== null}
      municipality={muniChip}
      onClearNear={area.clearNear}
      onClearBbox={area.clearBbox}
      onClearMunicipality={() => area.setMunicipality('')}
    />
  )
}

export function StationFilterControls({
  state,
  originLabel = null,
}: {
  state: StationFiltersState
  /** 起点の駅の表示名（図の応答の `near.label`・チップに出す）。 */
  originLabel?: string | null
}) {
  const count = detailCount(state)
  // 詳しい条件が効いていれば開いて始める（URL・チャットから来た条件を隠さない）。
  const [detailOpen, setDetailOpen] = useState(count > 0)
  const detailId = useId()
  const { area } = state
  return (
    <>
      <PrefectureMultiSelect
        selected={[...state.values.prefectures]}
        onChange={state.setPrefectures}
        allowed={state.allowedPrefectures}
        allowedScope={state.prefectureScope}
      />
      <MunicipalitySelect
        value={area.municipality}
        prefecture={area.singlePrefecture}
        state={area.municipalities}
        onChange={area.setMunicipality}
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
      <LineMultiSelect
        selected={state.values.lines}
        onChange={state.setLines}
        lines={state.lineList}
        isLoading={state.linesLoading}
        error={state.linesError}
        allowed={state.allowedLines}
        allowedScope={state.lineScope}
      />
      <DetailToggle
        open={detailOpen}
        count={count}
        controls={detailId}
        onToggle={() => setDetailOpen((open) => !open)}
      />
      {detailOpen && <DetailConditions id={detailId} state={state} />}
      <AreaChipsOf state={state} originLabel={originLabel} />
    </>
  )
}
