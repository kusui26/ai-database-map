/**
 * 文字列 → 条件の値（純関数）。URL からもセレクタからも同じ関数で落とす。
 *
 * `as` は使わない（CLAUDE.md §3）。**知らない値は既定に倒す**——URL は人が手で書き換えられるし、
 * 古いリンクには消えた選択肢が残っていることもある。落とすより既定で動くほうがよく、
 * どの条件で計算したかは応答が必ず返すので、黙って別の答えになることはない。
 */

import { RADII_M, type HazardLevel } from '@/shared/constants'
import { SUMMARY_HAZARD_GROUPS, type SummaryHazardGroup } from '@/shared/hazard-summary'
import {
  flaggedPolicySchema,
  hazardPenaltyIdSchema,
  hazardPolicyModeSchema,
  normalizeMethodSchema,
  recommendPresetIdSchema,
  type FlaggedPolicy,
  type HazardPenaltyId,
  type HazardPolicyMode,
  type NormalizeMethod,
  type RecommendPresetId,
} from '@/shared/recommend'
import { DEFAULT_CRITERIA, quantizeWeight } from './query'

/** 足切りに使える下限。`none` は入れない——「想定区域外以上」は候補が全部消えるだけ。 */
export const CUTOFF_LEVELS: readonly HazardLevel[] = ['caution', 'warning', 'danger', 'critical']

/** 選択肢から 1 つ選ぶ（無ければ既定）。 */
function pick<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

export function toPreset(value: string): RecommendPresetId {
  return pick(recommendPresetIdSchema.options, value, DEFAULT_CRITERIA.preset)
}

export function toMethod(value: string): NormalizeMethod {
  return pick(normalizeMethodSchema.options, value, DEFAULT_CRITERIA.method)
}

export function toHazardMode(value: string): HazardPolicyMode {
  return pick(hazardPolicyModeSchema.options, value, DEFAULT_CRITERIA.hazard)
}

export function toGroup(value: string): SummaryHazardGroup {
  return pick(SUMMARY_HAZARD_GROUPS, value, DEFAULT_CRITERIA.hazardGroup)
}

export function toLevel(value: string): HazardLevel {
  return pick(CUTOFF_LEVELS, value, DEFAULT_CRITERIA.hazardAtOrAbove)
}

export function toPenalty(value: string): HazardPenaltyId {
  return pick(hazardPenaltyIdSchema.options, value, DEFAULT_CRITERIA.hazardPenalty)
}

export function toFlagged(value: string): FlaggedPolicy {
  return pick(flaggedPolicySchema.options, value, DEFAULT_CRITERIA.flagged)
}

/** カタログの列が存在する 6 段だけ（それ以外は既定）。 */
export function toRadiusM(value: number): number {
  return RADII_M.find((radius) => radius === value) ?? DEFAULT_CRITERIA.radiusM
}

/** カンマ区切り → 配列（空要素は落とす）。 */
export function toList(value: string): readonly string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** カンマ区切りの整数（事業者種別）。整数でないものは落とす。 */
export function toNumberList(value: string): readonly number[] {
  return toList(value)
    .map(Number)
    .filter((item) => Number.isInteger(item))
}

/** 「指標名:重み」の並び → 重み。壊れた要素は落とす（URL の 1 文字で全部が無になるのを避ける）。 */
export function toWeights(value: string): Readonly<Record<string, number>> {
  const entries = toList(value).flatMap((part) => {
    const [name, raw] = part.split(':')
    const weight = Number(raw)
    if (name === undefined || name.length === 0 || !Number.isFinite(weight) || weight < 0) return []
    return [[name, quantizeWeight(weight)] as const]
  })
  return Object.fromEntries(entries)
}
