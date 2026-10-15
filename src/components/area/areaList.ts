/**
 * エリアの図で選んでいるエリアの並び（純関数・2026-10-15 B5e）。
 *
 * - 「＋比べる」は末尾に足す・札を押して選んだら、その位置を替える。同じエリアは 1 回だけ（重ねると「横浜市・横浜市の比較」になる）
 * - 4 つまで（共通 API の上限・`MAX_AREAS`）。外せるのは 2 つ以上あるときだけ（エリアの無い図にしない）
 * - 札の名前は共通 API の応答から引く（並びは指定どおりに返る）。条件を替えた直後は前の応答から名前を引き、無ければ「読み込み中」
 */

import { MAX_AREAS } from '@/shared/area-ref'
import { type AreaSummaryResponse } from '@/shared/area-summary'

/** どこへ入れるか：足す（比べる）か、その位置を替えるか。 */
export type PickTarget =
  { readonly mode: 'add' } | { readonly mode: 'replace'; readonly index: number }

/** 同じ入れ先か（同じ札・「＋比べる」をもう一度押したら閉じる）。 */
export function samePickTarget(a: PickTarget, b: PickTarget): boolean {
  if (a.mode === 'add' || b.mode === 'add') return a.mode === b.mode
  return a.index === b.index
}

/** 選んだエリアを入れる（同じエリアは前にあるほうを残す・4 つまで）。 */
export function withPicked(
  areas: readonly string[],
  target: PickTarget,
  ref: string,
): readonly string[] {
  const next =
    target.mode === 'add'
      ? [...areas, ref]
      : areas.map((area, index) => (index === target.index ? ref : area))
  return [...new Set(next)].slice(0, MAX_AREAS)
}

/** その位置のエリアを外す（1 つしか無ければ外さない）。 */
export function withoutAt(areas: readonly string[], index: number): readonly string[] {
  return areas.length <= 1 ? areas : areas.filter((_area, at) => at !== index)
}

/** まだ足せるか（4 つ未満）。 */
export function canAddArea(areas: readonly string[]): boolean {
  return areas.length < MAX_AREAS
}

/**
 * 札の名前（`null`＝まだ名前が無い＝読み込み中）。いまの条件の応答があれば並びで引き（エリアは正規の形に直って返ることがある）、
 * 無ければ前の応答から同じエリアを探す。取得に失敗した（知らないエリアなど）なら、名前の無い札はエリアの文字列のまま——
 * 「読み込み中」と出し続けない。
 */
export function slotLabels(
  areas: readonly string[],
  summary: AreaSummaryResponse | undefined,
  latest: AreaSummaryResponse | undefined,
  failed = false,
): readonly (string | null)[] {
  if (summary !== undefined) return areas.map((ref, index) => summary.areas[index]?.labelJa ?? ref)
  return areas.map(
    (ref) => latest?.areas.find((area) => area.ref === ref)?.labelJa ?? (failed ? ref : null),
  )
}
