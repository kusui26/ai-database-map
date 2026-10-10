/**
 * ドメイン：県内・市内での**位置**の言い方（純関数・2026-10-09 B4）。
 *
 * 順位は DB が数える（`station_profile_ranks`：値の大きい順・同じ値は同じ順位・比べるのは値のある駅だけ）。
 * ここは、その順位を「上位 19%」「下位 3%」と言い、目盛りの位置（百分位）にする。
 *
 * - **上位／下位は値の大きさ**で、良し悪しではない（地価の上位＝高い、人口の増減の下位＝減っている側）
 * - 割合は**切り上げ**：1 位でも「上位 1%」（「上位 0%」とは言わない）。ちょうど真ん中は「上位 50%」
 * - 比べる駅が少ないと位置は読めない（「3 駅中 1 位」で「上位 34%」）。5 駅未満では出さない
 */

import { formatNumber } from '@/shared/format'
import { type ProfilePosition, type ProfileScope } from '@/shared/profile'

/** 比べる駅がこれより少なければ位置を出さない。 */
export const MIN_COMPARED_STATIONS = 5

/** 百分率の分母。 */
const PERCENT = 100

/** ちょうど真ん中の言い方（駅の数が奇数のときの中央の順位）。 */
export const MIDDLE_JA = '真ん中'

/**
 * 「上位 19%」「下位 3%」。整数で割ってから切り上げる（浮動小数の 3.0000000000000004 で 4% にしない）。
 * 奇数の駅のちょうど中央（53 駅中 27 位）は、上から数えても下から数えても半分を超える（「下位 51%」）ので「真ん中」と言う。
 */
export function shareJa(rank: number, total: number): string {
  if (rank * 2 === total + 1) return MIDDLE_JA
  if (rank * 2 <= total) return `上位 ${Math.ceil((rank * PERCENT) / total)}%`
  return `下位 ${Math.ceil(((total - rank + 1) * PERCENT) / total)}%`
}

/** 目盛りの位置の刻み（小数 1 桁）。描くのに十分で、応答の JSON を短く保つ。 */
const PERCENTILE_STEPS_PER_POINT = 10

/** 目盛りの位置（0〜100・100 ＝最も大きい・小数 1 桁）。1 駅しか無ければ真ん中。 */
export function percentileOf(rank: number, total: number): number {
  if (total <= 1) return PERCENT / 2
  const raw = ((total - rank) / (total - 1)) * PERCENT
  return Math.round(raw * PERCENTILE_STEPS_PER_POINT) / PERCENTILE_STEPS_PER_POINT
}

/**
 * 比べた範囲の短い言い方（「神奈川県」→「県内」・「東京都」→「都内」・「北海道」→「道内」・
 * 「横浜市」→「市内」・「千代田区」→「区内」・「瑞穂町」→「町内」）。名前の最後の 1 字に「内」を付ける。
 */
export function shortScopeJa(name: string): string {
  return `${Array.from(name).at(-1) ?? ''}内`
}

/**
 * 順位 → 位置。比べる駅が少ない・順位が範囲の外（DB の形が崩れた）なら null。
 * `name` は比べた範囲の名前（「神奈川県」「横浜市」）。
 */
export function positionOf(
  scope: ProfileScope,
  name: string,
  rank: number,
  total: number,
): ProfilePosition | null {
  const valid = Number.isInteger(rank) && Number.isInteger(total) && rank >= 1 && rank <= total
  if (!valid || total < MIN_COMPARED_STATIONS) return null
  const scopeJa = `${name}内`
  const share = shareJa(rank, total)
  return {
    scope,
    scopeJa,
    shortJa: shortScopeJa(name),
    rank,
    total,
    percentile: percentileOf(rank, total),
    shareJa: share,
    labelJa: `${scopeJa} ${formatNumber(total, 'int')} 駅中 ${formatNumber(rank, 'int')} 位（${share}）`,
  }
}

/** 位置の凡例（「位置は 県内＝神奈川県、市内＝横浜市 の駅と比べたものです（…）」）。 */
export function positionsLegendJa(prefecture: string, area: string | null): string {
  const scopes = [prefecture, ...(area === null ? [] : [area])]
  const pairs = scopes.map((name) => `${shortScopeJa(name)}＝${name}`).join('、')
  return `位置は ${pairs} の駅と比べたものです（値の大きい順・数字は順位/駅数）。`
}
