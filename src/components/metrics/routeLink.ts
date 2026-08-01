/**
 * 運営会社フィルタと路線フィルタの連動（純関数・260731）。
 *
 * 都道府県⇄会社の連動（`operatorLink.ts`）と同じ考え方を路線に広げる：
 * **選べない組合せは最初から出さない**。会社を選べば路線候補はその会社の路線だけになり
 * （東海旅客鉄道 → 13 本）、路線・種別を選べば会社候補もその路線を持つ会社だけになる
 * （新幹線 → 5 社）。0 件になる組合せを事前に潰すのが目的
 * （docs/260730_scatter_plot_routes.md §5）。
 *
 * 都道府県と違い**自動選択はしない**（`auto` 相当の状態を持たない）。
 * 路線は会社より細かく、勝手に増えると意図しない集計になるため、選択は常に明示的にする。
 */

import { type Route } from '@/shared/api'

/** 選択中の会社が運営する路線名（`/api/routes` の並び＝駅数降順を保つ）。 */
export function routesOfOperators(
  operators: readonly string[],
  routes: readonly Route[],
): string[] {
  if (operators.length === 0) return routes.map((route) => route.route)
  const wanted = new Set(operators)
  return routes
    .filter((route) => route.operators.some((operator) => wanted.has(operator)))
    .map((route) => route.route)
}

/**
 * 選択中の路線・種別を持つ会社（重複なし・`routes` の並び順）。
 * 路線と種別は OR（§9 決定 3）なので、両方の会社集合の**和**を返す。
 *
 * 同名路線は `/api/routes` が会社と種別をまとめて返すため、
 * 「A 社は在来線・B 社は新幹線」の同名路線では A も候補に残る（安全側＝候補を狭めすぎない）。
 */
export function operatorsOfRouteFilter(
  selectedRoutes: readonly string[],
  selectedTypes: readonly number[],
  routes: readonly Route[],
): string[] {
  const wantedRoutes = new Set(selectedRoutes)
  const wantedTypes = new Set(selectedTypes)
  const names = new Set<string>()
  for (const route of routes) {
    const hit =
      wantedRoutes.has(route.route) || route.routeTypes.some((type) => wantedTypes.has(type))
    if (hit) for (const operator of route.operators) names.add(operator)
  }
  return [...names]
}

/**
 * 会社の候補を絞っている条件の名前（説明文用・両方なら「都道府県・路線」）。
 * 候補が減った理由を取り違えて伝えないために、実際に効いている条件だけを並べる。
 */
export function narrowedByLabel(
  prefectures: readonly string[],
  routes: readonly string[],
  routeTypes: readonly number[],
): string {
  const scopes: string[] = []
  if (prefectures.length > 0) scopes.push('都道府県')
  if (routes.length > 0 || routeTypes.length > 0) scopes.push('路線')
  return scopes.join('・')
}

/**
 * 2 つの候補集合を重ねる（`undefined` ＝ その軸では絞っていない）。
 * 会社の候補は「都道府県による絞り」と「路線による絞り」の**両方**を満たす必要がある（AND）。
 */
export function intersectAllowed(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): readonly string[] | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  const other = new Set(b)
  return a.filter((item) => other.has(item))
}
