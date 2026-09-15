/**
 * ドメイン：**重み付き合成**（純関数・`docs/260912_gui_chat_protocol.md` §13.4-1/2/5）。
 *
 * 正規化済み（大きいほど良い）の値を、重みを掛けて足す。返すのは順位だけでなく
 * **内訳**——どの指標がどれだけ効いたか——で、これが無いと合成スコアは読めない。
 *
 * ## 欠損と ⚠ を黙って使わない
 *
 * - **欠損**（列が無い）は候補から外す。0 で埋めない。0 は「値が 0」であって「不明」ではない
 * - **⚠**（信頼性フラグ）は、外すか印を付けるかを呼び出し側が選ぶ。既定は印（`annotate`）
 *
 * どちらも**外した駅と理由を返す**ので、件数と代表例を本文に書ける。
 */

import type {
  CandidateStation,
  ExcludedStation,
  FlaggedPolicy,
  MetricContribution,
  ScoredMetric,
} from './types'

/**
 * 重みの合計を 1 に揃える（負は 0 として扱う）。合計 0（全部 0）は割れないので均等にする。
 *
 * 配列で受けるのは、**画面のスライダも同じ関数で割合を出せる**ようにするため。
 * 同じ重みなのに画面と応答で違う % が出る、という食い違いを作らない。
 */
export function shareOfWeights(weights: readonly number[]): readonly number[] {
  const clamped = weights.map((weight) => Math.max(weight, 0))
  const total = clamped.reduce((sum, weight) => sum + weight, 0)
  const even = 1 / weights.length
  return clamped.map((weight) => (total > 0 ? weight / total : even))
}

/** 指標ごとの重みを合計 1 に揃える（key → 割合）。 */
export function normalizeWeights(
  metrics: readonly ScoredMetric[],
): Readonly<Record<string, number>> {
  const shares = shareOfWeights(metrics.map((metric) => metric.weight))
  return Object.fromEntries(metrics.map((metric, index) => [metric.key, shares[index] ?? 0]))
}

/** その駅で値が無い指標の key（空なら全部そろっている）。 */
export function missingKeys(
  station: CandidateStation,
  metrics: readonly ScoredMetric[],
): readonly string[] {
  return metrics.filter((metric) => !(metric.key in station.values)).map((metric) => metric.key)
}

/** その駅で ⚠ が立っている指標の key。 */
export function flaggedKeys(
  station: CandidateStation,
  metrics: readonly ScoredMetric[],
): readonly string[] {
  return metrics
    .filter((metric) => metric.reliabilityFlagKey !== null)
    .filter((metric) => (station.values[metric.reliabilityFlagKey ?? ''] ?? 0) === 1)
    .map((metric) => metric.key)
}

/**
 * 欠損と ⚠ で候補を仕分ける。**残す駅**と**外した駅（理由つき）**を返す。
 * 災害の足切りは別（`hazardGate`）——理由の種類が違うので混ぜない。
 */
export function screen(
  stations: readonly CandidateStation[],
  metrics: readonly ScoredMetric[],
  flagged: FlaggedPolicy,
): { readonly kept: readonly CandidateStation[]; readonly excluded: readonly ExcludedStation[] } {
  const kept: CandidateStation[] = []
  const excluded: ExcludedStation[] = []
  for (const station of stations) {
    const missing = missingKeys(station, metrics)
    if (missing.length > 0) {
      excluded.push({
        grp: station.grp,
        name: station.name,
        reason: { kind: 'missing', keys: missing },
      })
      continue
    }
    const flags = flagged === 'exclude' ? flaggedKeys(station, metrics) : []
    if (flags.length > 0) {
      excluded.push({
        grp: station.grp,
        name: station.name,
        reason: { kind: 'flagged', keys: flags },
      })
      continue
    }
    kept.push(station)
  }
  return { kept, excluded }
}

/** 1 駅ぶんの内訳を組む。`normalized` は指標ごとに事前計算した列から引く。 */
export function contributionsOf(
  station: CandidateStation,
  metrics: readonly ScoredMetric[],
  normalized: Readonly<Record<string, number>>,
  weights: Readonly<Record<string, number>>,
): readonly MetricContribution[] {
  const flags = new Set(flaggedKeys(station, metrics))
  return metrics.map((metric) => {
    const score = normalized[metric.key] ?? 0
    return {
      key: metric.key,
      raw: station.values[metric.key] ?? 0,
      normalized: score,
      contribution: score * (weights[metric.key] ?? 0),
      flagged: flags.has(metric.key),
    }
  })
}

/** 内訳の合計から災害の段階減点を引いたもの。 */
export function scoreOf(breakdown: readonly MetricContribution[], hazardPenalty: number): number {
  return breakdown.reduce((sum, item) => sum + item.contribution, 0) - hazardPenalty
}
