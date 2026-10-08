'use client'

/**
 * 駅の絞り込み（都道府県 × 運営会社 × 路線 × 法令上の路線・事業者種別）の状態と連動（260801）。
 *
 * 散布・ランキング・おすすめは同じ条件で絞る。連動の規則（0 件になる組合せを出さない・
 * 会社を外したら自動で入った県だけ外す・候補は都道府県 ∩ 路線）を **1 か所**にまとめ、
 * 画面ごとに挙動がズレないようにする（.claude/CLAUDE.md §3 DRY）。
 *
 * 路線（運行系統・`lines`）は 2026-10-08 L4 で選べるようにした：都道府県・会社を選べば路線の候補が、
 * 路線を選べば都道府県・会社の候補が絞られる（`lineLink.ts`）。
 *
 * 純粋な計算は `operatorLink.ts` / `routeLink.ts` / `lineLink.ts` にあり、ここは状態と取得の束ね役。
 */

import { useCallback, useMemo, useState } from 'react'
import { type Line, type Operator, type Route } from '@/shared/api'
import { allowedCandidates, narrowingScopes, type StationFilterValues } from './filterLink'
import { useLines } from './useLines'
import { useOperators } from './useOperators'
import { useRoutes } from './useRoutes'
import {
  applyManualPrefectures,
  EMPTY_LINK,
  type LinkState,
  prefectureIndex,
  prefecturesOfOperators,
  pruneAutoPrefectures,
  selectOperatorPrefectures,
} from './operatorLink'

/** チャットからの昇格で初期値を preset する（未指定は絞らない）。 */
export type StationFilterInitial = {
  readonly prefectures?: readonly string[]
  readonly operators?: readonly string[]
  readonly routes?: readonly string[]
  readonly routeTypes?: readonly number[]
  readonly lines?: readonly number[]
}

export type StationFiltersState = {
  readonly values: StationFilterValues
  /** 一覧（セレクタの選択肢）。 */
  readonly operatorList: readonly Operator[]
  readonly routeList: readonly Route[]
  readonly lineList: readonly Line[]
  readonly operatorsLoading: boolean
  readonly routesLoading: boolean
  readonly linesLoading: boolean
  readonly operatorsError: Error | undefined
  readonly routesError: Error | undefined
  readonly linesError: Error | undefined
  /** 連動：選べる候補（undefined＝絞っていない）。 */
  readonly allowedPrefectures: readonly string[] | undefined
  readonly allowedOperators: readonly string[] | undefined
  readonly allowedRoutes: readonly string[] | undefined
  readonly allowedLines: readonly number[] | undefined
  /** 候補を絞っている条件の名前（説明文の主語）。 */
  readonly prefectureScope: string
  readonly operatorScope: string
  readonly lineScope: string
  /** 「この会社の都道府県を選択（N県）」に出す県数。 */
  readonly applyPrefectureCount: number
  readonly setPrefectures: (prefectures: string[]) => void
  readonly setOperators: (operators: string[]) => void
  readonly setRoutes: (routes: string[]) => void
  readonly setRouteTypes: (routeTypes: number[]) => void
  readonly setLines: (lines: number[]) => void
  readonly applyOperatorPrefectures: () => void
}

/** `open` が false の間は一覧を取りに行かない（ダイアログを開いたときだけ取得）。 */
export function useStationFilters(
  open: boolean,
  initial?: StationFilterInitial,
): StationFiltersState {
  // 都道府県は「手動で入れた分」と「会社連動で入った分（auto）」を区別して持つ。
  const [link, setLink] = useState<LinkState>(
    initial === undefined
      ? EMPTY_LINK
      : { prefectures: [...(initial.prefectures ?? [])], auto: [] },
  )
  const [operators, setOperators] = useState<string[]>([...(initial?.operators ?? [])])
  const [routes, setRoutes] = useState<string[]>([...(initial?.routes ?? [])])
  const [routeTypes, setRouteTypes] = useState<number[]>([...(initial?.routeTypes ?? [])])
  const [lines, setLines] = useState<number[]>([...(initial?.lines ?? [])])

  const prefectures = link.prefectures
  const {
    operators: operatorList,
    isLoading: operatorsLoading,
    error: operatorsError,
  } = useOperators(open)
  const { routes: routeList, isLoading: routesLoading, error: routesError } = useRoutes(open)
  const { lines: lineList, isLoading: linesLoading, error: linesError } = useLines(open)
  const index = useMemo(() => prefectureIndex(operatorList), [operatorList])

  const values = useMemo<StationFilterValues>(
    () => ({ prefectures, operators, routes, routeTypes, lines }),
    [prefectures, operators, routes, routeTypes, lines],
  )
  // 双方向の連動：会社・路線を選べば県の候補が、県や路線を選べば会社の候補が絞られる（`filterLink.ts`）。
  const allowed = useMemo(
    () =>
      allowedCandidates(values, {
        operators: operatorList,
        routes: routeList,
        lines: lineList,
        prefecturesByOperator: index,
      }),
    [values, operatorList, routeList, lineList, index],
  )
  const scopes = useMemo(() => narrowingScopes(values), [values])
  const applyPrefectureCount = useMemo(
    () =>
      prefecturesOfOperators(operators, index).filter(
        (prefecture) => !prefectures.includes(prefecture),
      ).length,
    [operators, index, prefectures],
  )

  const setPrefectures = useCallback((next: string[]) => {
    setLink((state) => applyManualPrefectures(state, next))
  }, [])
  const onOperators = useCallback(
    (next: string[]) => {
      setOperators(next)
      setLink((state) => pruneAutoPrefectures(state, next, index))
    },
    [index],
  )
  const applyOperatorPrefectures = useCallback(() => {
    setLink((state) => selectOperatorPrefectures(state, operators, index))
  }, [operators, index])

  return {
    values,
    operatorList,
    routeList,
    lineList,
    operatorsLoading,
    routesLoading,
    linesLoading,
    operatorsError,
    routesError,
    linesError,
    allowedPrefectures: allowed.prefectures,
    allowedOperators: allowed.operators,
    allowedRoutes: allowed.routes,
    allowedLines: allowed.lines,
    prefectureScope: scopes.prefectures,
    operatorScope: scopes.operators,
    lineScope: scopes.lines,
    applyPrefectureCount,
    setPrefectures,
    setOperators: onOperators,
    setRoutes,
    setRouteTypes,
    setLines,
    applyOperatorPrefectures,
  }
}
