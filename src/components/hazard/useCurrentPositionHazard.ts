'use client'

/** 現在地の災害リスク（`useHazardPoint` の薄いラッパ・`docs/260824_flood.md` §8.3）。 */

import type { CurrentPosition } from '@/stores/geoStore'
import { useHazardPoint, type HazardPointState } from './useHazardPoint'

/** 現在地の呼び名（応答の `placeJa` と `hazardCard` の見出しに出る）。 */
export const CURRENT_PLACE_JA = '現在地'

export type CurrentPositionHazard = HazardPointState

/**
 * 現在地（null＝未測位）から災害リスクを取る。
 * 動いている間は、新しい位置の結果が届くまで前の位置の結果を出し続ける（同じ「現在地」なので・カードをちらつかせない）。
 */
export function useCurrentPositionHazard(position: CurrentPosition | null): CurrentPositionHazard {
  return useHazardPoint(
    position === null ? null : { lon: position.lon, lat: position.lat, placeJa: CURRENT_PLACE_JA },
    { keepPrevious: true },
  )
}
