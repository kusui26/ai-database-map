/**
 * ドメイン：色分けの境目の**読みやすい数**（純関数・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * 凡例に「25,432〜31,876 人」と書かれても読めない。境目は丸めた数にし、**丸めた境目で分ける**（凡例の数と色が食い違わない）。
 * - 水準（人口・地価…）：有効 2 桁に丸める（25,432 → 25,000・315,000 → 320,000）
 * - 増減（%）：1・2・5 の数（0.5・1・2・5・10・20…）
 */

/** 有効数字の桁で丸める（0 は 0）。 */
export function roundSignificant(value: number, digits: number): number {
  if (value === 0 || !Number.isFinite(value)) return value
  const magnitude = Math.floor(Math.log10(Math.abs(value)))
  const scale = 10 ** (magnitude - digits + 1)
  return Number((Math.round(value / scale) * scale).toPrecision(digits))
}

/** 1・2・5 の数の倍率（10 のべきに掛ける）。 */
const NICE_STEPS = [1, 2, 5] as const

/** x の桁の 1・2・5 の数と、次の桁の 1（例 x=6.3 → 1・2・5・10）。 */
function niceCandidates(value: number): number[] {
  const magnitude = Math.floor(Math.log10(value))
  const base = 10 ** magnitude
  return [...NICE_STEPS, 10].map((step) => Number((step * base).toPrecision(12)))
}

/** 正の数に**いちばん近い** 1・2・5 の数（比で近さを測る：6.3 → 5、7.5 → 10、30 → 20）。正でなければ 0。 */
export function nearestNice(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0
  const distance = (candidate: number): number => Math.abs(Math.log10(candidate / value))
  return niceCandidates(value).reduce((best, candidate) =>
    distance(candidate) < distance(best) ? candidate : best,
  )
}

/** 正の数**以下で最大**の 1・2・5 の数（1.25 → 1、12.5 → 10、0.3 → 0.2）。正でなければ 0。 */
export function largestNiceAtMost(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0
  const fits = niceCandidates(value).filter((candidate) => candidate <= value * (1 + 1e-12))
  return fits[fits.length - 1] ?? 0
}
