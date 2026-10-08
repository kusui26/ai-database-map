/**
 * ドメイン：絞り込み条件の表示ラベル（純関数・260801）。
 *
 * 散布とランキングは同じ条件（都道府県・運営会社・路線（運行系統）・法令上の路線・事業者種別）で絞れる。
 * パネルのタイトルに「何で絞った図/表か」を残すための文言を **1 か所**で決め、
 * 2 つのパネルで表記がズレないようにする（.claude/CLAUDE.md §3 DRY）。
 */

import {
  lineLabel,
  operatorLabel,
  prefectureLabel,
  routeLabel,
  routeTypeLabel,
} from '@/shared/constants'

/** 絞り込み条件（GrowthResponse / RankingResponse が構造的に満たす）。 */
export type FilterScope = {
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
  /** 路線（運行系統・261008 L2）。名前で題に出す。 */
  readonly lines?: readonly { readonly name: string }[]
}

/**
 * 対象範囲の表示（例「全国・東海旅客鉄道・新幹線」「全国・JR山手線」）。
 * 都道府県は未選択でも「全国」と出し、それ以外は**絞ったものだけ**を併記する。
 * 路線（運行系統）は法令上の路線より先に出す（利用者が呼ぶ名前のほうが読み手に近い）。
 */
export function scopeLabel(scope: FilterScope): string {
  const scopes = [prefectureLabel(scope.prefectures)]
  const lines = scope.lines ?? []
  if (scope.operators.length > 0) scopes.push(operatorLabel(scope.operators))
  if (lines.length > 0) scopes.push(lineLabel(lines.map((line) => line.name)))
  if (scope.routes.length > 0) scopes.push(routeLabel(scope.routes))
  if (scope.routeTypes.length > 0) scopes.push(scope.routeTypes.map(routeTypeLabel).join('・'))
  return scopes.join('・')
}
