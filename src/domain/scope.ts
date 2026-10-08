/**
 * ドメイン：絞り込み条件の表示ラベル（純関数・260801）。
 *
 * 散布とランキングは同じ条件（都道府県・市区町村・範囲・近傍・運営会社・路線（運行系統）・法令上の路線・事業者種別）で絞れる。
 * パネルのタイトルに「何で絞った図/表か」を残すための文言を **1 か所**で決め、
 * 2 つのパネルで表記がズレないようにする（.claude/CLAUDE.md §3 DRY）。
 */

import {
  lineLabel,
  MAP_AREA_LABEL_JA,
  nearLabel,
  operatorLabel,
  prefectureLabel,
  routeLabel,
  routeTypeLabel,
} from '@/shared/constants'
import { type Viewport } from '@/shared/viewport'

/** 場所の条件（都道府県・市区町村・範囲・起点と半径）。 */
export type PlaceScope = {
  readonly prefectures: readonly string[]
  /** 市区町村（前方一致の値・2026-10-08 B2）。null・無い＝絞っていない。 */
  readonly municipality?: string | null
  /** 範囲（値は題に出さず「地図の表示範囲」と言う・B2）。 */
  readonly bbox?: Viewport | null
  /** 起点と半径（「竹橋から 5km」・B2）。 */
  readonly near?: { readonly label: string; readonly radiusM: number } | null
}

/** 絞り込み条件（GrowthResponse / RankingResponse が構造的に満たす）。 */
export type FilterScope = PlaceScope & {
  readonly operators: readonly string[]
  /** 会社の表示名（`operators` と同じ順・駅データ.jp の事業者名・261008 L4）。無ければ会社名のまま出す。 */
  readonly operatorLabels?: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
  /** 路線（運行系統・261008 L2）。名前で題に出す。 */
  readonly lines?: readonly { readonly name: string }[]
}

/**
 * 会社の表示名の並び（`operators` と同じ長さのときだけ使う。古い応答・表示名の無い呼び出しは会社名のまま）。
 * 応答を組む側（presenter）もこれで埋めるので、題と応答の `operatorLabels` は同じ名前になる。
 */
export function displayOperators(
  operators: readonly string[],
  labels: readonly string[] | undefined,
): string[] {
  return labels !== undefined && labels.length === operators.length ? [...labels] : [...operators]
}

/**
 * 場所の言い方（都道府県 → 市区町村 → 起点から N km → 地図の表示範囲・住所と同じく広い順）。
 * どれも無ければ「全国」。「全国・竹橋から 5km」とは言わない。
 */
export function placeLabel(scope: PlaceScope): string {
  const places = [
    ...(scope.prefectures.length > 0 ? [prefectureLabel(scope.prefectures)] : []),
    ...(scope.municipality ? [scope.municipality] : []),
    ...(scope.near ? [nearLabel(scope.near.label, scope.near.radiusM)] : []),
    ...(scope.bbox ? [MAP_AREA_LABEL_JA] : []),
  ]
  return places.length > 0 ? places.join('・') : '全国'
}

/**
 * 対象範囲の表示（例「全国・JR東海・新幹線」「神奈川県・横浜市」「竹橋から 5km」）。
 * 場所は未指定でも「全国」と出し、それ以外は**絞ったものだけ**を併記する。
 * 会社は表示名（「東京都」ではなく「東京都交通局」）。路線（運行系統）は法令上の路線より先に出す
 * （利用者が呼ぶ名前のほうが読み手に近い）。
 */
export function scopeLabel(scope: FilterScope): string {
  const scopes = [placeLabel(scope)]
  const lines = scope.lines ?? []
  const operators = displayOperators(scope.operators, scope.operatorLabels)
  if (operators.length > 0) scopes.push(operatorLabel(operators))
  if (lines.length > 0) scopes.push(lineLabel(lines.map((line) => line.name)))
  if (scope.routes.length > 0) scopes.push(routeLabel(scope.routes))
  if (scope.routeTypes.length > 0) scopes.push(scope.routeTypes.map(routeTypeLabel).join('・'))
  return scopes.join('・')
}
