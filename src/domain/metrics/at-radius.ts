/**
 * ドメイン：**指標を、選んだ半径の同じ変種に替える**（純関数・2026-11-14）。
 *
 * ランキング・散布の図は、地図で選んでいる半径（`?r`）で始め、地図の半径が替われば図の指標も
 * その半径に替える（`components/metrics/useMetricChoice.ts`）。以前は図ごとの既定の指標の半径
 * （ランキング 1km・散布 2km）で開き、地図の半径と食い違っていた。
 *
 * 指標がその半径を持たなければ、近い半径に替える（地価の増減率は 500m・20km を、地価の中央値は 20km を
 * 持たない）。近さの物差しは、駅周辺のプロフィール・エリアの要約と同じ `radiiByCloseness`。
 */

import { getEntry } from '@/shared/catalog'
import { isRadiusM, type Category, type RadiusM } from '@/shared/constants'
import { type MetricVariant, rankableVariantGroups, variantTokenOf } from '@/domain/metrics'
import { radiiByCloseness } from './family'

/** 変種の、選んだ半径に最も近い key（半径の無い変種はその key。どの半径も持たなければ undefined）。 */
export function variantKeyNear(variant: MetricVariant, radiusM: RadiusM): string | undefined {
  const independent = variant.byRadius.get(null)
  if (independent !== undefined) return independent
  const radius = radiiByCloseness(radiusM).find((candidate) => variant.byRadius.has(candidate))
  return radius === undefined ? undefined : variant.byRadius.get(radius)
}

/** key の変種（ランキング・散布に出せる指標だけ。それ以外は undefined）。 */
function variantOf(key: string): MetricVariant | undefined {
  const category = getEntry(key)?.category
  const token = variantTokenOf(key)
  if (category === undefined || token === undefined) return undefined
  return rankableVariantGroups(category)
    .flatMap((group) => group.variants)
    .find((variant) => variant.token === token)
}

/** 指標を、選んだ半径（無ければ近い半径）の同じ変種に替える。半径の無い指標・知らない key はそのまま。 */
export function keyAtRadius(key: string, radiusM: RadiusM): string {
  const variant = variantOf(key)
  return variant === undefined ? key : (variantKeyNear(variant, radiusM) ?? key)
}

/** カテゴリの最初の指標を、選んだ半径（無ければ近い半径）で。カテゴリを替えたときの既定。 */
export function firstKeyAtRadius(category: Category, radiusM: RadiusM): string | undefined {
  const first = rankableVariantGroups(category)[0]?.variants[0]
  return first === undefined ? undefined : variantKeyNear(first, radiusM)
}

/** 指標を選び直すときに合わせる半径：いまの指標の半径（半径の無い指標・知らない key なら地図の半径）。 */
export function preferredRadius(key: string, mapRadiusM: RadiusM): RadiusM {
  const radius = getEntry(key)?.radiusM ?? null
  return radius !== null && isRadiusM(radius) ? radius : mapRadiusM
}

/**
 * 図を開いたときの指標。開いた図に指標があればそれ（チャットの ⤢・戻る・共有リンク——地図の半径で上書きしない）、
 * 無ければ（FAB で開いた直後）既定の指標を地図の半径で。カタログに無い key（手で書き換えた URL など）も既定へ。
 */
export function openingMetricKey(
  key: string | null,
  fallback: string,
  mapRadiusM: RadiusM,
): string {
  return key !== null && getEntry(key) !== undefined ? key : keyAtRadius(fallback, mapRadiusM)
}
