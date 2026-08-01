'use client'

/**
 * 駅の絞り込み（都道府県 × 運営会社 × 路線・事業者種別）の状態と連動（260801）。
 *
 * 散布とランキングは同じ 4 条件で絞る。連動の規則（0 件になる組合せを出さない・
 * 会社を外したら自動で入った県だけ外す・候補は都道府県 ∩ 路線）を **1 か所**にまとめ、
 * 2 画面で挙動がズレないようにする（.claude/CLAUDE.md §3 DRY）。
 *
 * 純粋な計算は `operatorLink.ts` / `routeLink.ts` にあり、ここは状態と取得の束ね役。
 */

import { useCallback, useMemo, useState } from 'react'
import { type Operator, type Route } from '@/shared/api'
import { useOperators } from './useOperators'
import { useRoutes } from './useRoutes'
import {
  applyManualPrefectures,
  EMPTY_LINK,
  type LinkState,
  operatorsInPrefectures,
  prefectureIndex,
  prefecturesOfOperators,
  pruneAutoPrefectures,
  selectOperatorPrefectures,
} from './operatorLink'
import {
  intersectAllowed,
  narrowedByLabel,
  operatorsOfRouteFilter,
  routesOfOperators,
} from './routeLink'

/** 絞り込みの値（そのまま API のクエリになる・空＝絞らない）。 */
export type StationFilterValues = {
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
}

/** チャットからの昇格で初期値を preset する（未指定は絞らない）。 */
export type StationFilterInitial = {
  readonly prefectures?: readonly string[]
  readonly operators?: readonly string[]
  readonly routes?: readonly string[]
  readonly routeTypes?: readonly number[]
}

export type StationFiltersState = {
  readonly values: StationFilterValues
  /** 一覧（セレクタの選択肢）。 */
  readonly operatorList: readonly Operator[]
  readonly routeList: readonly Route[]
  readonly operatorsLoading: boolean
  readonly routesLoading: boolean
  readonly operatorsError: Error | undefined
  readonly routesError: Error | undefined
  /** 連動：選べる候補（undefined＝絞っていない）。 */
  readonly allowedPrefectures: readonly string[] | undefined
  readonly allowedOperators: readonly string[] | undefined
  readonly allowedRoutes: readonly string[] | undefined
  /** 会社候補を絞っている条件の名前（説明文の主語）。 */
  readonly operatorScope: string
  /** 「この会社の都道府県を選択（N県）」に出す県数。 */
  readonly applyPrefectureCount: number
  readonly setPrefectures: (prefectures: string[]) => void
  readonly setOperators: (operators: string[]) => void
  readonly setRoutes: (routes: string[]) => void
  readonly setRouteTypes: (routeTypes: number[]) => void
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

  const prefectures = link.prefectures
  const {
    operators: operatorList,
    isLoading: operatorsLoading,
    error: operatorsError,
  } = useOperators(open)
  const { routes: routeList, isLoading: routesLoading, error: routesError } = useRoutes(open)
  const index = useMemo(() => prefectureIndex(operatorList), [operatorList])

  // 双方向の連動：会社を選べば県・路線の候補が、県や路線を選べば会社の候補が絞られる。
  const allowedPrefectures = useMemo(
    () => (operators.length === 0 ? undefined : prefecturesOfOperators(operators, index)),
    [operators, index],
  )
  const allowedRoutes = useMemo(
    () => (operators.length === 0 ? undefined : routesOfOperators(operators, routeList)),
    [operators, routeList],
  )
  const allowedOperators = useMemo(() => {
    const byPrefecture =
      prefectures.length === 0 ? undefined : operatorsInPrefectures(prefectures, operatorList)
    const byRoute =
      routes.length === 0 && routeTypes.length === 0
        ? undefined
        : operatorsOfRouteFilter(routes, routeTypes, routeList)
    return intersectAllowed(byPrefecture, byRoute)
  }, [prefectures, operatorList, routes, routeTypes, routeList])
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
    values: { prefectures, operators, routes, routeTypes },
    operatorList,
    routeList,
    operatorsLoading,
    routesLoading,
    operatorsError,
    routesError,
    allowedPrefectures,
    allowedOperators,
    allowedRoutes,
    operatorScope: narrowedByLabel(prefectures, routes, routeTypes),
    applyPrefectureCount,
    setPrefectures,
    setOperators: onOperators,
    setRoutes,
    setRouteTypes,
    applyOperatorPrefectures,
  }
}
