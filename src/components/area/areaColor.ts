/**
 * エリアの図の「地図の色分け」の選び方（純関数・2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。
 *
 * 色分けの指標は**駅の周りの半径と同じ半径**で引く（AI の道具 `getAreaSummary` と同じ「色分けの指標もこの半径」）。
 * 画面では指標（カテゴリと年）だけを選ばせ、半径は図の 1 つの半径で決める——半径の部品が 2 つ並ぶと、どちらが何の半径か
 * 分からない。その半径に無い指標は近い半径（`radiiByCloseness`）、半径の無い指標（乗降客数）はそのまま。
 *
 * 図の値（URL の `figColor`）は、既定（人口の増減・5 年・その半径・`domain/style/color-metric.ts`）と同じなら null——
 * 半径を替えても既定のまま付いてくる。色分けできない key（手で書き換えた URL）は既定に戻す。
 */

import { CATEGORIES, NO_COLORING, type Category, type RadiusM } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { radiiByCloseness } from '@/domain/metrics/family'
import { rankableVariantGroups, variantTokenOf, type MetricVariant } from '@/domain/metrics'
import { colorableEntry, defaultColorEntry } from '@/domain/style/color-metric'

/** いまの選択（色分けしない／指標）。 */
export type ColorSelection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'metric'
      readonly key: string
      readonly category: Category
      /** 変種（半径を除いた指標）のトークン（`<option>` の値）。 */
      readonly token: string
    }

/** 色分けに選べるカテゴリ（ランキングできる指標のあるもの）。 */
export const COLOR_CATEGORIES: readonly Category[] = CATEGORIES.filter(
  (category) => rankableVariantGroups(category).length > 0,
)

/** 既定と同じ key は null（URL に書かない）。 */
function normalized(key: string, radiusM: RadiusM): string | null {
  return defaultColorEntry(radiusM)?.key === key ? null : key
}

/** 図の色分けの値 → 既定に寄せた値（色分けできない key は既定・既定と同じ key は null）。 */
export function normalizeColorBy(colorBy: string | null, radiusM: RadiusM): string | null {
  if (colorBy === null || colorBy === NO_COLORING) return colorBy
  return colorableEntry(colorBy) === null ? null : normalized(colorBy, radiusM)
}

/** 図の色分けの値 → いまの選択（null は既定の指標）。 */
export function colorSelectionOf(colorBy: string | null, radiusM: RadiusM): ColorSelection {
  if (colorBy === NO_COLORING) return { kind: 'none' }
  const entry = (colorBy === null ? null : colorableEntry(colorBy)) ?? defaultColorEntry(radiusM)
  const token = entry === null ? undefined : variantTokenOf(entry.key)
  if (entry === null || token === undefined) return { kind: 'none' }
  return { kind: 'metric', key: entry.key, category: entry.category, token }
}

/** 変種 → その半径の key（無ければ近い半径・半径の無い指標はそのまま）。 */
export function variantKeyAt(variant: MetricVariant, radiusM: RadiusM): string | undefined {
  const exact = variant.byRadius.get(radiusM) ?? variant.byRadius.get(null)
  if (exact !== undefined) return exact
  const nearest = radiiByCloseness(radiusM).find((radius) => variant.byRadius.has(radius))
  return nearest === undefined ? undefined : variant.byRadius.get(nearest)
}

function variantsOf(category: Category): readonly MetricVariant[] {
  return rankableVariantGroups(category).flatMap((group) => group.variants)
}

/** 変種を選んだ → 図の色分けの値（知らない変種なら今のまま）。 */
export function colorByForVariant(
  category: Category,
  token: string,
  radiusM: RadiusM,
  current: string | null,
): string | null {
  const variant = variantsOf(category).find((each) => each.token === token)
  const key = variant === undefined ? undefined : variantKeyAt(variant, radiusM)
  return key === undefined ? current : normalized(key, radiusM)
}

/** カテゴリを選んだ（`none`＝色分けしない）→ 図の色分けの値（カテゴリの最初の指標）。 */
export function colorByForCategory(
  value: string,
  radiusM: RadiusM,
  current: string | null,
): string | null {
  if (value === NO_COLORING) return NO_COLORING
  const category = COLOR_CATEGORIES.find((each) => each === value)
  const first = category === undefined ? undefined : variantsOf(category)[0]
  if (category === undefined || first === undefined) return current
  return colorByForVariant(category, first.token, radiusM, current)
}

/** 半径を替えた → 同じ指標をその半径で引き直す（既定・色分けしないはそのまま）。 */
export function colorByAtRadius(colorBy: string | null, radiusM: RadiusM): string | null {
  if (colorBy === null || colorBy === NO_COLORING) return colorBy
  const entry = getEntry(colorBy)
  const token = variantTokenOf(colorBy)
  if (entry === undefined || token === undefined) return null
  return colorByForVariant(entry.category, token, radiusM, colorBy)
}
