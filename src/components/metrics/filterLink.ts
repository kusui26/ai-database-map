/**
 * 絞り込みの連動をまとめて決める（純関数・2026-10-08 L4）。
 *
 * どのセレクタの候補を、どの条件が絞るか：
 *
 * | 候補 | 絞る条件 |
 * |---|---|
 * | 都道府県 | 会社（走る県）・路線（駅のある県） |
 * | 会社 | 都道府県（走る会社）・法令上の路線と種別（その会社）・路線（路線の会社） |
 * | 法令上の路線 | 会社（その会社の路線） |
 * | 路線 | 都道府県（駅のある路線）・会社（その会社の路線） |
 *
 * 2 つ以上の条件が絞るときは重ねる（AND）。個々の規則は `operatorLink.ts`・`routeLink.ts`・`lineLink.ts`。
 */

import { type Line, type Operator, type Route } from '@/shared/api'
import {
  linesInPrefectures,
  linesOfOperators,
  operatorsOfLines,
  prefecturesOfLines,
} from './lineLink'
import { operatorsInPrefectures, prefecturesOfOperators } from './operatorLink'
import {
  activeScopeLabel,
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
  /** 路線（運行系統）の路線コード（選んだ順・2026-10-08 L3/L4）。 */
  readonly lines: readonly number[]
}

/** セレクタの選択肢（一覧の取得結果）と、会社 → 走る都道府県の索引。 */
export type FilterLists = {
  readonly operators: readonly Operator[]
  readonly routes: readonly Route[]
  readonly lines: readonly Line[]
  readonly prefecturesByOperator: ReadonlyMap<string, string[]>
}

/** 選べる候補（`undefined`＝その候補は絞っていない）。 */
export type AllowedCandidates = {
  readonly prefectures: readonly string[] | undefined
  readonly operators: readonly string[] | undefined
  readonly routes: readonly string[] | undefined
  readonly lines: readonly number[] | undefined
}

function allowedPrefectures(
  values: StationFilterValues,
  lists: FilterLists,
): readonly string[] | undefined {
  const byOperators =
    values.operators.length === 0
      ? undefined
      : prefecturesOfOperators(values.operators, lists.prefecturesByOperator)
  return intersectAllowed(byOperators, prefecturesOfLines(values.lines, lists.lines))
}

function allowedOperators(
  values: StationFilterValues,
  lists: FilterLists,
): readonly string[] | undefined {
  const byPrefectures =
    values.prefectures.length === 0
      ? undefined
      : operatorsInPrefectures(values.prefectures, lists.operators)
  const byRoutes =
    values.routes.length === 0 && values.routeTypes.length === 0
      ? undefined
      : operatorsOfRouteFilter(values.routes, values.routeTypes, lists.routes)
  const byLines = operatorsOfLines(values.lines, lists.lines)
  return intersectAllowed(intersectAllowed(byPrefectures, byRoutes), byLines)
}

export function allowedCandidates(
  values: StationFilterValues,
  lists: FilterLists,
): AllowedCandidates {
  return {
    prefectures: allowedPrefectures(values, lists),
    operators: allowedOperators(values, lists),
    routes:
      values.operators.length === 0 ? undefined : routesOfOperators(values.operators, lists.routes),
    lines: intersectAllowed(
      linesInPrefectures(values.prefectures, lists.lines),
      linesOfOperators(values.operators, lists.lines),
    ),
  }
}

/** 候補を絞っている条件の名前（説明文の主語：「選択中の会社・路線が走る 3 県のみ選べます」）。 */
export type NarrowingScopes = {
  readonly prefectures: string
  readonly operators: string
  readonly lines: string
}

export function narrowingScopes(values: StationFilterValues): NarrowingScopes {
  const hasOperators = values.operators.length > 0
  return {
    prefectures: activeScopeLabel([
      ['会社', hasOperators],
      ['路線', values.lines.length > 0],
    ]),
    operators: narrowedByLabel(values.prefectures, values.routes, values.routeTypes, values.lines),
    lines: activeScopeLabel([
      ['都道府県', values.prefectures.length > 0],
      ['会社', hasOperators],
    ]),
  }
}
