/**
 * ドメイン：**おすすめ駅の応答を組み立てる**（純関数・`docs/260912_gui_chat_protocol.md` §13.4）。
 *
 * 出すのは順位だけではない。採った方法・重み・**何を候補にしたか**・外した駅と理由・
 * 揺らしたときの振る舞い・限界・出典が揃って初めて読める。型（`recommendResponseSchema`）の
 * 側でどれも省けないようにしてあり、ここがそれを埋める唯一の場所になる。
 *
 * ## 候補集合を隠さない
 *
 * W2 の突き合わせで分かったこと——同じ重み・同じ方法でも、候補が 1 駅違えば順位が変わる
 * （min-max もパーセンタイルも候補の分布で決まるため）。画面にはその食い違いに気づく相手が
 * いないので、**絞り込みと駅数を必ず返す**（`area` ／ `candidateCount` ／ 注記の 1 行目）。
 */

import { getEntry, type CatalogEntry } from '@/shared/catalog'
import { formatNumber } from '@/shared/format'
import { HAZARD_GROUP_LABELS_JA, HAZARD_LEVEL_LABELS_JA } from '@/shared/constants'
import type {
  RecommendArea,
  RecommendContribution,
  RecommendExcluded,
  RecommendHazardPolicy,
  RecommendMetric,
  RecommendQuery,
  RecommendResponse,
  RecommendRow,
  RecommendSensitivity,
  StationListItem,
} from '@/shared/api'
import type { HazardPenaltyId } from '@/shared/recommend'
import { HAZARD_SUMMARY_LIMITATIONS_JA, hazardSummarySources } from '@/domain/hazard/summary'
import { sourcesForKeys } from '@/domain/sources'
import {
  areaLabelJa,
  directionJa,
  exclusionJa,
  flaggedJa,
  hazardPolicyJa,
  methodJa,
  radiusJa,
  sensitivityJa,
} from './labels'
import { RECOMMEND_PRESETS } from './presets'
import type { RecommendRunInput, RecommendRunOk } from './run'
import type {
  CandidateStation,
  HazardPolicy,
  MetricContribution,
  ScoredMetric,
  ScoredStation,
} from './types'

/** 除外の代表例として返す件数（**件数そのものは `excludedCounts` が正**・§13.4-3）。 */
export const EXCLUDED_SAMPLE_LIMIT = 50

export type RecommendPresentation = {
  readonly query: RecommendQuery
  readonly input: RecommendRunInput
  /** 重みを既定から動かしたか。 */
  readonly customized: boolean
  readonly run: RecommendRunOk
}

/** 増減率は符号を付ける（ランキングの整形と同じ規約）。 */
function formatValue(entry: CatalogEntry | undefined, value: number): string {
  if (entry === undefined) return String(value)
  const signed = entry.kind === 'growth' || entry.kind === 'error'
  return formatNumber(value, entry.format, { signed })
}

/** 実際に効いた指標だけ（重み 0 は仕分けにも合成にも使っていない・W1 の決定②）。 */
function usedMetrics(run: RecommendRunOk): readonly ScoredMetric[] {
  return run.metrics.filter((metric) => run.result.weights[metric.key] !== undefined)
}

function metricViews(run: RecommendRunOk, used: readonly ScoredMetric[]): RecommendMetric[] {
  const degenerate = new Map(run.result.degenerate.map((item) => [item.key, item.reason]))
  return used.flatMap((metric) => {
    const entry = getEntry(metric.key)
    if (entry === undefined) return []
    return [
      {
        key: entry.key,
        baseMetric: entry.baseMetric,
        labelJa: entry.labelJa,
        unit: entry.unit,
        format: entry.format,
        radiusM: entry.radiusM,
        year: entry.year,
        yearBase: entry.yearBase,
        direction: metric.direction,
        directionJa: directionJa(metric.direction),
        weight: run.result.weights[metric.key] ?? 0,
        degenerate: degenerate.get(metric.key) ?? null,
      },
    ]
  })
}

function contributionViews(breakdown: readonly MetricContribution[]): RecommendContribution[] {
  return breakdown.map((item) => ({
    key: item.key,
    value: item.raw,
    formatted: formatValue(getEntry(item.key), item.raw),
    normalized: item.normalized,
    contribution: item.contribution,
    flagged: item.flagged,
  }))
}

/** 選んだグループの危険度。サマリが無い駅は **`null`＝不明**（`none` と混ぜない）。 */
function hazardCell(
  scored: ScoredStation,
  candidate: CandidateStation | undefined,
  policy: HazardPolicy,
): RecommendRow['hazard'] {
  if (policy.mode === 'off') return null
  const summary = candidate?.hazard ?? null
  if (summary === null) {
    return {
      level: null,
      levelJa: '不明（判定できませんでした）',
      worstJa: null,
      penalty: scored.hazardPenalty,
      uncovered: true,
      nearby: false,
    }
  }
  const group = summary.groups[policy.group]
  return {
    level: group.level,
    levelJa: HAZARD_LEVEL_LABELS_JA[group.level],
    worstJa: group.worstJa,
    penalty: scored.hazardPenalty,
    uncovered: group.uncovered,
    nearby: group.nearby,
  }
}

function rowView(
  scored: ScoredStation,
  rank: number,
  station: StationListItem,
  candidate: CandidateStation | undefined,
  policy: HazardPolicy,
): RecommendRow {
  return {
    rank,
    grp: scored.grp,
    name: scored.name,
    label: station.label,
    prefecture: station.prefecture,
    municipality: station.municipality,
    lon: station.lon,
    lat: station.lat,
    score: scored.score,
    breakdown: contributionViews(scored.breakdown),
    hazard: hazardCell(scored, candidate, policy),
  }
}

function excludedViews(run: RecommendRunOk): RecommendExcluded[] {
  return run.result.excluded.slice(0, EXCLUDED_SAMPLE_LIMIT).map((entry) => ({
    grp: entry.grp,
    name: entry.name,
    kind: entry.reason.kind,
    reasonJa: exclusionJa(entry.reason),
  }))
}

function excludedCounts(run: RecommendRunOk): RecommendResponse['excludedCounts'] {
  const kinds = run.result.excluded.map((entry) => entry.reason.kind)
  return {
    missing: kinds.filter((kind) => kind === 'missing').length,
    flagged: kinds.filter((kind) => kind === 'flagged').length,
    hazard: kinds.filter((kind) => kind === 'hazard').length,
    total: kinds.length,
  }
}

function sensitivityView(
  run: RecommendRunOk,
  names: ReadonlyMap<string, string>,
  topN: number,
): RecommendSensitivity {
  const ref = (grp: string) => ({ grp, name: names.get(grp) ?? grp })
  const { sensitivity } = run.result
  return {
    runs: sensitivity.runs,
    stable: sensitivity.stable,
    verdictJa: sensitivityJa(sensitivity, topN),
    swaps: sensitivity.swaps.map(([a, b]) => ({ a: ref(a), b: ref(b) })),
    enteredTop: sensitivity.enteredTop.map(ref),
    leftTop: sensitivity.leftTop.map(ref),
  }
}

function hazardPolicyView(policy: HazardPolicy, penalty: HazardPenaltyId): RecommendHazardPolicy {
  const labelJa = hazardPolicyJa(policy, penalty)
  if (policy.mode === 'off') {
    return {
      mode: 'off',
      group: null,
      groupJa: null,
      atOrAbove: null,
      penalty: null,
      steps: null,
      labelJa,
    }
  }
  const shared = { group: policy.group, groupJa: HAZARD_GROUP_LABELS_JA[policy.group], labelJa }
  return policy.mode === 'exclude'
    ? { ...shared, mode: 'exclude', atOrAbove: policy.atOrAbove, penalty: null, steps: null }
    : { ...shared, mode: 'penalty', atOrAbove: null, penalty, steps: policy.steps }
}

function areaView(input: RecommendRunInput): RecommendArea {
  const { filter } = input
  return {
    prefectures: [...(filter.prefectures ?? [])],
    municipality: filter.municipality ?? null,
    operators: [...(filter.operators ?? [])],
    routes: [...(filter.routes ?? [])],
    routeTypes: [...(filter.routeTypes ?? [])],
    bbox: filter.bbox === undefined ? null : { ...filter.bbox },
    labelJa: areaLabelJa(filter),
  }
}

/** 埋めた既定・使えなかった指定・効かなかった指標——**黙って済ませたことが無い**ようにする。 */
function notes(context: RecommendPresentation, used: readonly ScoredMetric[]): string[] {
  const { run, input } = context
  const dead = run.result.degenerate.map((item) => getEntry(item.key)?.labelJa ?? item.key)
  const unknownHazard = run.gathered.candidates.filter((item) => item.hazard === null).length
  return [
    `「${areaLabelJa(input.filter)}」の ${run.gathered.stationCount} 駅を候補にしました（候補が変われば順位も変わります）。`,
    ...run.notes,
    ...(run.unresolved.length === 0
      ? []
      : [`カタログに無い指標の指定は使っていません: ${run.unresolved.join('・')}`]),
    ...(dead.length === 0
      ? []
      : [`${dead.join('・')}は候補の中で差が付かず、順位に効いていません。`]),
    ...(input.specs.every((spec) => spec.weight <= 0)
      ? [`重みがすべて 0 だったので、${used.length} 指標を等しく扱いました。`]
      : []),
    ...(input.hazard.mode !== 'off' && unknownHazard > 0
      ? [
          `${unknownHazard} 駅は災害サマリを取得できず「不明」のまま残しました（安全という意味ではありません）。`,
        ]
      : []),
    ...(input.method === 'zscore' && input.hazard.mode === 'penalty'
      ? ['z-score は 0〜1 の目盛りではないので、減点の効き方が他の方法と変わります。']
      : []),
  ]
}

/** **必ず末尾に表示する**（§13.4-6）。合成スコアを「正解」と読ませないための文。 */
function limitations(context: RecommendPresentation, used: readonly ScoredMetric[]): string[] {
  const entries = used.flatMap((metric) => {
    const entry = getEntry(metric.key)
    return entry === undefined ? [] : [entry]
  })
  return [
    '順位はこの候補集合の中での相対評価です。候補が変われば順位も変わります。',
    '合成スコアは重みの選び方で変わります。同じデータでも、正規化の方法を変えれば並びは変わります。',
    ...(entries.some((entry) => entry.radiusM !== null)
      ? [
          `半径を持つ指標は、駅の代表点から ${radiusJa(context.input.radiusM)}の集計です（徒歩圏や行政区域とは一致しません）。`,
        ]
      : []),
    ...(entries.some((entry) => entry.category === 'land_price')
      ? ['地価は地価公示（土地の価格）であり、マンション価格そのものではありません。']
      : []),
    ...(entries.some((entry) => entry.baseMetric.startsWith('pop_gr_pred'))
      ? ['将来人口は推計値で、実績ではありません。']
      : []),
    ...(context.input.hazard.mode === 'off' ? [] : HAZARD_SUMMARY_LIMITATIONS_JA),
  ]
}

/** 使った列と（災害を見たなら）その出典。**データを渡すときに権利表記を落とさない**。 */
function sources(
  used: readonly ScoredMetric[],
  policy: HazardPolicy,
): { source: string; license: string }[] {
  const metricSources = sourcesForKeys(used.map((metric) => metric.key))
  const all = [...metricSources, ...(policy.mode === 'off' ? [] : hazardSummarySources())]
  const seen = new Map(all.map((entry) => [`${entry.source} ${entry.license}`, entry]))
  return [...seen.values()]
}

/** 実行結果 → 応答。ここだけが `recommendResponseSchema` の形を知っている。 */
export function presentRecommendation(context: RecommendPresentation): RecommendResponse {
  const { query, input, run } = context
  const used = usedMetrics(run)
  const stations = new Map(run.gathered.stations.map((station) => [station.grp, station]))
  const candidates = new Map(run.gathered.candidates.map((item) => [item.grp, item]))
  const names = new Map(run.gathered.stations.map((s) => [s.grp, s.stationName]))
  const preset = RECOMMEND_PRESETS[query.preset]
  const rows = run.result.ranked.flatMap((scored, index) => {
    const station = stations.get(scored.grp)
    return station === undefined
      ? []
      : [rowView(scored, index + 1, station, candidates.get(scored.grp), input.hazard)]
  })
  return {
    area: areaView(input),
    preset: {
      id: preset.id,
      labelJa: preset.labelJa,
      noteJa: preset.noteJa,
      customized: context.customized,
    },
    method: input.method,
    methodJa: methodJa(input.method),
    radiusM: input.radiusM,
    hazard: hazardPolicyView(input.hazard, query.hazardPenalty),
    flagged: run.result.flagged,
    flaggedJa: flaggedJa(run.result.flagged),
    metrics: metricViews(run, used),
    candidateCount: run.gathered.stationCount,
    rankedCount: run.result.ranked.length,
    rows: rows.slice(0, query.limit),
    excluded: excludedViews(run),
    excludedCounts: excludedCounts(run),
    topN: query.topN,
    sensitivity: sensitivityView(run, names, query.topN),
    notesJa: notes(context, used),
    limitationsJa: limitations(context, used),
    sources: sources(used, input.hazard),
  }
}
