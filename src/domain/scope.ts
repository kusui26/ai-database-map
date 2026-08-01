/**
 * ドメイン：絞り込み条件の表示ラベル（純関数・260801）。
 *
 * 散布とランキングは同じ 4 条件（都道府県・運営会社・路線・事業者種別）で絞れる。
 * パネルのタイトルに「何で絞った図/表か」を残すための文言を **1 か所**で決め、
 * 2 つのパネルで表記がズレないようにする（.claude/CLAUDE.md §3 DRY）。
 */

import { operatorLabel, prefectureLabel, routeLabel, routeTypeLabel } from '@/shared/constants'

/** 絞り込み条件（GrowthResponse / RankingResponse が構造的に満たす）。 */
export type FilterScope = {
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
}

/**
 * 対象範囲の表示（例「全国・東海旅客鉄道・新幹線」）。
 * 都道府県は未選択でも「全国」と出し、それ以外は**絞ったものだけ**を併記する。
 */
export function scopeLabel(scope: FilterScope): string {
  const scopes = [prefectureLabel(scope.prefectures)]
  if (scope.operators.length > 0) scopes.push(operatorLabel(scope.operators))
  if (scope.routes.length > 0) scopes.push(routeLabel(scope.routes))
  if (scope.routeTypes.length > 0) scopes.push(scope.routeTypes.map(routeTypeLabel).join('・'))
  return scopes.join('・')
}
