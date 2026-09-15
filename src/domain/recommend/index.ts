/**
 * ドメイン：**「おすすめ駅」の合成**（純関数の入口・`docs/260912_gui_chat_protocol.md` §13）。
 *
 * 出すのは順位だけではない。**内訳・外した駅と理由・揺らしたときの振る舞い・採った方法**を
 * 一緒に返す。合成スコアは、それらが添わなければ読めないから。
 *
 * ## 手順
 *
 * 1. **重みのある指標だけ**を使う（0 にした指標のせいで駅が落ちないように）
 * 2. 欠損と ⚠ で仕分ける（`screen`）——0 で埋めない
 * 3. 災害の足切り／段階減点（`hazardGate`）——`uncovered` は不明として残す
 * 4. **残った駅の分布**で正規化する（`normalize`）——外した駅は分布に入れない
 * 5. 重みを掛けて足す（`compose`）
 * 6. 重みを ±20% 振って安定性を見る（`sensitivity`）
 *
 * 4 が「残った駅の分布で」なのは意図的。足切りで外した駅を分布に残すと、
 * 「候補の中での相対位置」がずれる——見せているのは**候補の中での順位**なので。
 */

import { contributionsOf, normalizeWeights, screen, scoreOf } from './compose'
import { hazardGate } from './hazard-gate'
import { normalize } from './normalize'
import { DEFAULT_TOP_N, sensitivity, type SensitivityRow } from './sensitivity'
import type {
  CandidateStation,
  DegenerateMetric,
  ExcludedStation,
  RecommendOptions,
  RecommendResult,
  ScoredMetric,
  ScoredStation,
} from './types'

/** 重みのある指標だけ。1 つも無ければ、指定された全部を等しく扱う（好みが無い＝引き分け）。 */
function activeMetrics(metrics: readonly ScoredMetric[]): readonly ScoredMetric[] {
  const positive = metrics.filter((metric) => metric.weight > 0)
  return positive.length > 0 ? positive : metrics
}

type GateResult = {
  readonly kept: readonly CandidateStation[]
  readonly excluded: readonly ExcludedStation[]
  readonly gates: ReadonlyMap<string, ReturnType<typeof hazardGate>>
}

/** 災害の足切りを掛ける。段階減点のときは全員残る。 */
function applyGate(
  stations: readonly CandidateStation[],
  policy: RecommendOptions['hazard'],
): GateResult {
  const kept: CandidateStation[] = []
  const excluded: ExcludedStation[] = []
  const gates = new Map<string, ReturnType<typeof hazardGate>>()
  for (const station of stations) {
    const gate = hazardGate(station, policy)
    gates.set(station.grp, gate)
    if (gate.keep) kept.push(station)
    else if (policy.mode === 'exclude' && gate.excludedAt !== null)
      excluded.push({
        grp: station.grp,
        name: station.name,
        reason: { kind: 'hazard', group: policy.group, level: gate.excludedAt },
      })
  }
  return { kept, excluded, gates }
}

type NormalizedColumns = {
  /** 指標 key → （grp → 正規化値）。 */
  readonly byMetric: ReadonlyMap<string, ReadonlyMap<string, number>>
  readonly degenerate: readonly DegenerateMetric[]
}

/** 残った駅の分布で、指標ごとに正規化する。 */
function normalizeColumns(
  stations: readonly CandidateStation[],
  metrics: readonly ScoredMetric[],
  method: RecommendOptions['method'],
): NormalizedColumns {
  const byMetric = new Map<string, ReadonlyMap<string, number>>()
  const degenerate: DegenerateMetric[] = []
  for (const metric of metrics) {
    const values = stations.map((station) => station.values[metric.key] ?? 0)
    const outcome = normalize(values, method, metric.direction)
    byMetric.set(metric.key, new Map(stations.map((s, i) => [s.grp, outcome.scores[i] ?? 0])))
    if (outcome.degenerate !== null)
      degenerate.push({ key: metric.key, reason: outcome.degenerate })
  }
  return { byMetric, degenerate }
}

/** 1 駅ぶんの「指標 key → 正規化値」を取り出す。 */
function normalizedOf(
  grp: string,
  metrics: readonly ScoredMetric[],
  byMetric: NormalizedColumns['byMetric'],
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    metrics.map((metric) => [metric.key, byMetric.get(metric.key)?.get(grp) ?? 0]),
  )
}

/** スコア降順。同点は grp の辞書順（並びを決定的にする）。 */
function byScoreDesc(a: ScoredStation, b: ScoredStation): number {
  return b.score - a.score || a.grp.localeCompare(b.grp)
}

/**
 * 候補駅を絞り込み、順位・内訳・除外理由・敏感度を返す。
 * 入力は変更しない（純関数）。
 */
export function recommendStations(
  stations: readonly CandidateStation[],
  options: RecommendOptions,
): RecommendResult {
  const metrics = activeMetrics(options.metrics)
  const flagged = options.flagged ?? 'annotate'
  const topN = options.topN ?? DEFAULT_TOP_N
  const screened = screen(stations, metrics, flagged)
  const gated = applyGate(screened.kept, options.hazard)
  const weights = normalizeWeights(metrics)
  const { byMetric, degenerate } = normalizeColumns(gated.kept, metrics, options.method)

  const ranked = gated.kept
    .map((station) => {
      const gate = gated.gates.get(station.grp)
      const normalized = normalizedOf(station.grp, metrics, byMetric)
      const breakdown = contributionsOf(station, metrics, normalized, weights)
      const penalty = gate?.penalty ?? 0
      return {
        grp: station.grp,
        name: station.name,
        score: scoreOf(breakdown, penalty),
        breakdown,
        hazardPenalty: penalty,
        hazardUncovered: gate?.uncovered ?? false,
        hazardNearby: gate?.nearby ?? false,
      }
    })
    .sort(byScoreDesc)

  const rows: readonly SensitivityRow[] = ranked.map((station) => ({
    grp: station.grp,
    normalized: normalizedOf(station.grp, metrics, byMetric),
    hazardPenalty: station.hazardPenalty,
  }))

  return {
    ranked,
    excluded: [...screened.excluded, ...gated.excluded],
    sensitivity: sensitivity(rows, metrics, weights, topN),
    degenerate,
    method: options.method,
    weights,
    hazard: options.hazard,
    flagged,
  }
}

export { DEFAULT_TOP_N } from './sensitivity'
export { RECOMMEND_PRESETS, PRESET_IDS, weightSum } from './presets'
export { resolveMetrics, columnsFor } from './metrics'
export type { ResolvedMetrics } from './metrics'
export type { PresetId, PresetMetric, RecommendPreset } from './presets'
export * from './types'
