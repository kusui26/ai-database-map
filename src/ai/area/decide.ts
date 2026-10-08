/**
 * 同じ名前の場所（起点の駅・市区町村）をどう決めるか（純関数・2026-10-08 B2）。
 *
 * 路線（L3・`src/ai/routes/resolve.ts`）と同じ考え方で、都道府県で絞ったあとの候補から：
 *
 * 1. 候補が 1 つならそれ
 * 2. **強い**候補（名前そのもの）が 1 つで、それが地図の範囲の中か、範囲の中に候補が無ければそれ
 *    （「港区」は東京都港区。名古屋・大阪の「港区」は区の名前だけで当たった弱い候補）
 * 3. 地図の範囲の中に候補が 1 つならそれ（大阪の地図の「港区」は大阪市港区、首都圏の地図の「中区」は横浜市中区）
 * 4. 範囲の中の強い候補が 1 つならそれ
 * 5. 決まらなければ聞き返す（範囲の中に候補があれば、範囲の中の候補を挙げる）
 *
 * 路線と違い、強い 1 つが地図の範囲の外で、範囲の中に弱い候補があれば範囲を優先する（2）。大阪を見ている人の
 * 「北区」は大阪市北区——区の名前は、その地域の人が市の名前を省いて呼ぶ。
 */

import { type Viewport } from '@/shared/viewport'
import { type LonLat } from './place-index'

/** 候補（強い＝名前そのもの・弱い＝省いた言い方で当たった）。 */
export type PlaceCandidate<T> = {
  readonly item: T
  readonly strong: boolean
  readonly points: readonly LonLat[]
}

export type PlaceDecision<T> =
  | {
      readonly kind: 'one'
      readonly item: T
      /** どう決めたか（説明の書き方が変わる）。 */
      readonly how: 'only' | 'strong' | 'viewport'
      /** ほかの候補（説明に挙げる）。 */
      readonly others: readonly T[]
    }
  | { readonly kind: 'ambiguous'; readonly items: readonly T[] }
  | { readonly kind: 'none' }

function inside(point: LonLat, viewport: Viewport): boolean {
  return (
    point.lon >= viewport.west &&
    point.lon <= viewport.east &&
    point.lat >= viewport.south &&
    point.lat <= viewport.north
  )
}

/** 地図の範囲の中に駅があるか（範囲が無ければ null）。 */
function inViewport<T>(candidate: PlaceCandidate<T>, viewport: Viewport | null): boolean | null {
  if (viewport === null) return null
  return candidate.points.some((point) => inside(point, viewport))
}

function one<T>(
  chosen: PlaceCandidate<T>,
  how: 'only' | 'strong' | 'viewport',
  all: readonly PlaceCandidate<T>[],
): PlaceDecision<T> {
  const others = all.filter((candidate) => candidate !== chosen).map((candidate) => candidate.item)
  return { kind: 'one', item: chosen.item, how, others }
}

type Seen<T> = { readonly candidate: PlaceCandidate<T>; readonly visible: boolean | null }

/** 2：強い候補が 1 つで、範囲の中か、範囲の中に候補が無ければそれ。 */
function strongChoice<T>(
  seen: readonly Seen<T>[],
  visibleCount: number,
  all: readonly PlaceCandidate<T>[],
): PlaceDecision<T> | null {
  const strong = seen.filter((entry) => entry.candidate.strong)
  const [only] = strong
  if (strong.length !== 1 || only === undefined) return null
  return only.visible !== false || visibleCount === 0 ? one(only.candidate, 'strong', all) : null
}

/** 3・4：範囲の中の候補が 1 つ、または範囲の中の強い候補が 1 つならそれ。 */
function viewportChoice<T>(
  visible: readonly PlaceCandidate<T>[],
  all: readonly PlaceCandidate<T>[],
): PlaceDecision<T> | null {
  const [onlyVisible] = visible
  if (visible.length === 1 && onlyVisible !== undefined) return one(onlyVisible, 'viewport', all)
  const visibleStrong = visible.filter((candidate) => candidate.strong)
  const [only] = visibleStrong
  return visibleStrong.length === 1 && only !== undefined ? one(only, 'viewport', all) : null
}

export function decidePlace<T>(
  candidates: readonly PlaceCandidate<T>[],
  viewport: Viewport | null,
): PlaceDecision<T> {
  const [first] = candidates
  if (first === undefined) return { kind: 'none' }
  if (candidates.length === 1) return one(first, 'only', candidates)
  const seen = candidates.map((candidate) => ({
    candidate,
    visible: inViewport(candidate, viewport),
  }))
  const visible = seen.filter((entry) => entry.visible === true).map((entry) => entry.candidate)
  const pool = visible.length > 1 ? visible : candidates
  return (
    strongChoice(seen, visible.length, candidates) ??
    viewportChoice(visible, candidates) ?? { kind: 'ambiguous', items: pool.map((c) => c.item) }
  )
}
