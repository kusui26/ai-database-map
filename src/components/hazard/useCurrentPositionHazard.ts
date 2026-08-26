'use client'

/** 現在地の災害リスク（`useHazardPoint` の薄いラッパ・`docs/260824_flood.md` §8.3）。 */

import type { CurrentPosition } from '@/stores/geoStore'
import { useHazardPoint, type HazardPointState } from './useHazardPoint'

/** 現在地の呼び名（応答の `placeJa` と `hazardCard` の見出しに出る）。 */
export const CURRENT_PLACE_JA = '現在地'

export type CurrentPositionHazard = HazardPointState

/** 現在地（null＝未測位）から災害リスクを取る。 */
export function useCurrentPositionHazard(position: CurrentPosition | null): CurrentPositionHazard {
  return useHazardPoint(
    position === null ? null : { lon: position.lon, lat: position.lat, placeJa: CURRENT_PLACE_JA },
  )
}
