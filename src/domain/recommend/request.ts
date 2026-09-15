/**
 * ドメイン：**クエリ → 実行入力**（純関数・`docs/260912_gui_chat_protocol.md` §13.7 W3）。
 *
 * `/api/recommend` は HTTP の薄いラッパでいたい。だから「プリセットを引く・重みを差し替える・
 * 災害の方針を組む・絞り込みを組む」はここでやり、ルートは**検証済みの入力を渡すだけ**にする。
 * こうしておくと、DB もサーバも起こさずに入口の振る舞いを検査できる。
 *
 * ## 間違いは黙って直さない
 *
 * 知らない指標名で重みを渡されたら、**その指定を無視して既定で計算する**のが最悪の失敗になる。
 * 利用者は自分の重みで出た順位だと思って読むからだ。だから 400 にして、何が使えるかを返す。
 * 絞り込みが 1 つも無いとき（＝全国 9,273 駅）も同じで、勝手にどこかへ倒さない。
 */

import type { ListStationsFilter } from '@/db/queries'
import type { RecommendQuery } from '@/shared/api'
import { HAZARD_PENALTY_STEPS, RECOMMEND_PRESETS, type PresetMetric } from './presets'
import type { RecommendRunInput } from './run'
import type { HazardPolicy } from './types'

/**
 * 候補集合の上限。**超えたら切り詰めずに 400** にする——`list_stations` は乗降客数の降順なので、
 * 黙って頭を切ると「上位 N 駅の中での順位」という**言っていない判断**が混ざる。
 * 1 都道府県は必ず収まる（最多の東京都で 654 駅）。
 *
 * ⚠ **1,000 にはできない。** PostgREST は 1 回の応答を 1,000 行で打ち切るので
 * （`lim` に何を渡しても 1,000 行しか返らない・実測）、上限を 1,000 に置くと
 * 「1,001 件目が来たら多すぎる」という判定が**永久に成立しない**。
 * 壁より下に置いて、超過を超過として検出できるようにしてある。
 */
export const MAX_CANDIDATE_STATIONS = 800

export type RecommendInputResult =
  | {
      readonly ok: true
      readonly input: RecommendRunInput
      /** 重みを既定から動かしたか（応答の `preset.customized`）。 */
      readonly customized: boolean
    }
  | { readonly ok: false; readonly messageJa: string }

/** 絞り込みが 1 つでもあるか。無ければ全国が対象になってしまう。 */
function hasFilter(query: RecommendQuery): boolean {
  return (
    query.prefectures.length > 0 ||
    query.municipality !== undefined ||
    query.operators.length > 0 ||
    query.routes.length > 0 ||
    query.routeTypes.length > 0 ||
    query.bbox !== undefined
  )
}

/** "west,south,east,north" → bbox。数が合わない・数値でないときは null（呼び側が 400 にする）。 */
export function parseBbox(raw: string): ListStationsFilter['bbox'] | null {
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null
  const [west, south, east, north] = parts
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return null
  }
  return { west, south, east, north }
}

/** 災害の方針を組む。`penalty` の表は名前で選ぶ（数値の羅列を URL に載せない）。 */
export function hazardPolicyOf(query: RecommendQuery): HazardPolicy {
  if (query.hazard === 'off') return { mode: 'off' }
  if (query.hazard === 'exclude') {
    return { mode: 'exclude', group: query.hazardGroup, atOrAbove: query.hazardAtOrAbove }
  }
  return {
    mode: 'penalty',
    group: query.hazardGroup,
    steps: HAZARD_PENALTY_STEPS[query.hazardPenalty],
  }
}

/** プリセットの重みを上書きする。知らない指標名は `unknown` に積む（黙って捨てない）。 */
function overrideWeights(
  metrics: readonly PresetMetric[],
  weights: Readonly<Record<string, number>>,
): { readonly specs: readonly PresetMetric[]; readonly unknown: readonly string[] } {
  const known = new Set(metrics.map((metric) => metric.metric))
  return {
    specs: metrics.map((metric) => ({
      ...metric,
      weight: weights[metric.metric] ?? metric.weight,
    })),
    unknown: Object.keys(weights).filter((name) => !known.has(name)),
  }
}

/** 何を候補にするか（市区町村は前方一致・路線などは OR）。 */
function filterOf(query: RecommendQuery, bbox: ListStationsFilter['bbox']): ListStationsFilter {
  return {
    prefectures: query.prefectures,
    ...(query.municipality === undefined ? {} : { municipality: query.municipality }),
    operators: query.operators,
    routes: query.routes,
    routeTypes: query.routeTypes,
    ...(bbox === undefined ? {} : { bbox }),
  }
}

/** 検証済みクエリ → 実行入力。失敗は日本語 1 文で返す（ルートが 400 にする）。 */
export function buildRecommendInput(query: RecommendQuery): RecommendInputResult {
  if (!hasFilter(query)) {
    return {
      ok: false,
      messageJa: '対象を絞り込んでください（市区町村・都道府県・路線・地図範囲）。',
    }
  }
  const bbox = query.bbox === undefined ? undefined : parseBbox(query.bbox)
  if (bbox === null) {
    return { ok: false, messageJa: 'bbox は「西,南,東,北」の 4 つの数値で指定してください。' }
  }
  const preset = RECOMMEND_PRESETS[query.preset]
  const { specs, unknown } = overrideWeights(preset.metrics, query.weights ?? {})
  if (unknown.length > 0) {
    const names = preset.metrics.map((metric) => metric.metric).join(' / ')
    return {
      ok: false,
      messageJa: `weights に知らない指標名があります: ${unknown.join(', ')}。${preset.labelJa}で使えるのは ${names} です。`,
    }
  }
  return {
    ok: true,
    customized: specs.some((spec, index) => spec.weight !== preset.metrics[index]?.weight),
    input: {
      filter: filterOf(query, bbox),
      specs,
      radiusM: query.radiusM,
      method: query.method,
      hazard: hazardPolicyOf(query),
      flagged: query.flagged,
      topN: query.topN,
      maxStations: MAX_CANDIDATE_STATIONS,
    },
  }
}
