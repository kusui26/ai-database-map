/**
 * 都道府県フィルタと運営会社フィルタの連動（純関数・260731）。
 *
 * 実データでは（会社 × 都道府県）8,507 通りのうち実在は 289 通り（3.4%）しかなく、
 * 素朴に両方を選べると 96.6% が 0 件になる。そこで**選択肢を出し分け**（双方向）、
 * 「会社の都道府県をまとめて選ぶ」はボタンで明示的に行う
 * （docs/260730_scatter_plot_prefecture_to_operaters.md §2・§3）。
 *
 * 自動で入った都道府県（`auto`）とユーザーが自分で入れたものを区別し、
 * 会社を外したときに**自動分だけ**を取り除く（手動選択を壊さない）。
 */

import { type Operator } from '@/shared/api'

/** 都道府県の選択状態（`auto` は `prefectures` の部分集合）。 */
export type LinkState = {
  readonly prefectures: readonly string[]
  readonly auto: readonly string[]
}

/** 未選択（全国）。 */
export const EMPTY_LINK: LinkState = { prefectures: [], auto: [] }

/** 会社 → 走行する都道府県の索引（`/api/operators` の応答から作る）。 */
export function prefectureIndex(operators: readonly Operator[]): ReadonlyMap<string, string[]> {
  return new Map(operators.map((operator) => [operator.name, [...operator.prefectures]]))
}

/** 選択中の会社が走る都道府県（重複なし・昇順）。 */
export function prefecturesOfOperators(
  selected: readonly string[],
  index: ReadonlyMap<string, string[]>,
): string[] {
  const names = new Set(selected.flatMap((operator) => index.get(operator) ?? []))
  return [...names].sort()
}

/** 選択中の都道府県のいずれかを走る会社（重複なし・元の並び順を保つ）。 */
export function operatorsInPrefectures(
  prefectures: readonly string[],
  operators: readonly Operator[],
): string[] {
  if (prefectures.length === 0) return operators.map((operator) => operator.name)
  const wanted = new Set(prefectures)
  return operators
    .filter((operator) => operator.prefectures.some((prefecture) => wanted.has(prefecture)))
    .map((operator) => operator.name)
}

/**
 * 会社の選択が変わったときに、**自動で入った都道府県のうち行き場を失ったもの**だけ外す。
 * 手動で入れた都道府県は温存する（§3 規則 2）。
 */
export function pruneAutoPrefectures(
  state: LinkState,
  operators: readonly string[],
  index: ReadonlyMap<string, string[]>,
): LinkState {
  if (state.auto.length === 0) return state
  const covered = new Set(prefecturesOfOperators(operators, index))
  const auto = state.auto.filter((prefecture) => covered.has(prefecture))
  if (auto.length === state.auto.length) return state
  const dropped = new Set(state.auto.filter((prefecture) => !covered.has(prefecture)))
  return {
    prefectures: state.prefectures.filter((prefecture) => !dropped.has(prefecture)),
    auto,
  }
}

/**
 * 選択中の会社が走る都道府県をまとめて選ぶ（案 C のボタン）。
 * 追加分だけを `auto` に記録し、すでに手動で入っていた県は手動のまま残す（§3 規則 1）。
 */
export function selectOperatorPrefectures(
  state: LinkState,
  operators: readonly string[],
  index: ReadonlyMap<string, string[]>,
): LinkState {
  const target = prefecturesOfOperators(operators, index)
  if (target.length === 0) return state
  const current = new Set(state.prefectures)
  const added = target.filter((prefecture) => !current.has(prefecture))
  if (added.length === 0) return state
  return {
    prefectures: [...state.prefectures, ...added],
    auto: [...state.auto, ...added],
  }
}

/**
 * 都道府県セレクタの手動操作を反映する（§3 規則 3・4）。
 * 手で触れた県は `auto` から外れ、以後の会社操作では消えない。
 */
export function applyManualPrefectures(state: LinkState, next: readonly string[]): LinkState {
  const before = new Set(state.prefectures)
  const after = new Set(next)
  const touched = new Set([
    ...state.prefectures.filter((prefecture) => !after.has(prefecture)),
    ...next.filter((prefecture) => !before.has(prefecture)),
  ])
  return {
    prefectures: [...next],
    auto: state.auto.filter((prefecture) => after.has(prefecture) && !touched.has(prefecture)),
  }
}
