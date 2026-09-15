/**
 * おすすめ駅の条件 → `/api/recommend` の URL（純関数）。
 *
 * 画面の状態をそのままクエリにするだけで、**意味づけは持たない**——正規化も重みの正規化も
 * 除外の判断もサーバ側（`src/domain/recommend/`）にある。ここが決めるのは「何を送るか」だけ。
 *
 * ## 絞り込みが無いときは呼ばない
 *
 * API は絞り込みが 1 つも無いと 400 を返す（全国 9,273 駅を対象にしないため）。
 * それが分かっているのに投げて失敗を見せるのは不親切なので、`null` を返して
 * 「エリアを選んでください」に倒す。
 */

import type { HazardLevel } from '@/shared/constants'
import type { SummaryHazardGroup } from '@/shared/hazard-summary'
import type {
  FlaggedPolicy,
  HazardPenaltyId,
  HazardPolicyMode,
  NormalizeMethod,
  RecommendPresetId,
} from '@/shared/recommend'
import { RECOMMEND_PRESETS } from '@/domain/recommend/presets'

/** 表に出す上限（サーバの `limit`）。順位が付いた総数は `rankedCount` で別に返る。 */
export const RESULT_LIMIT = 50

/**
 * 重みの刻み。既定値がすべて 0.05 の倍数なので、同じ刻みなら「既定と同じ」を厳密に判定できる。
 *
 * ⚠ 刻みは**整数の逆数として持つ**。`Math.round(v / 0.05) * 0.05` と書くと
 * `6 * 0.05 === 0.30000000000000004` になり、既定の `0.3` と一致しなくなる
 * （＝変えていない重みを「変えた」と見なして URL に載せてしまう）。
 */
const WEIGHT_STEPS_PER_UNIT = 20
export const WEIGHT_STEP = 1 / WEIGHT_STEPS_PER_UNIT

export type RecommendCriteria = {
  readonly prefectures: readonly string[]
  /** 市区町村（前方一致・空＝指定なし）。「横浜市」で全区をまとめる。 */
  readonly municipality: string
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
  readonly preset: RecommendPresetId
  /** プリセットからの上書き（ファミリ名 → 重み）。空＝既定のまま。 */
  readonly weights: Readonly<Record<string, number>>
  readonly radiusM: number
  readonly method: NormalizeMethod
  readonly hazard: HazardPolicyMode
  readonly hazardGroup: SummaryHazardGroup
  readonly hazardAtOrAbove: HazardLevel
  readonly hazardPenalty: HazardPenaltyId
  readonly flagged: FlaggedPolicy
  readonly topN: number
}

/** 画面の初期値。**API の既定と同じ**にしてある（入口で答えが変わらないように）。 */
export const DEFAULT_CRITERIA: RecommendCriteria = {
  prefectures: [],
  municipality: '',
  operators: [],
  routes: [],
  routeTypes: [],
  preset: 'family',
  weights: {},
  radiusM: 1000,
  method: 'percentile',
  hazard: 'exclude',
  hazardGroup: 'flood',
  hazardAtOrAbove: 'danger',
  hazardPenalty: 'standard',
  flagged: 'annotate',
  topN: 5,
}

/** 刻みに丸める（0.1 + 0.2 のような誤差を持ち込まない）。 */
export function quantizeWeight(value: number): number {
  return Math.round(value * WEIGHT_STEPS_PER_UNIT) / WEIGHT_STEPS_PER_UNIT
}

/** 絞り込みが 1 つでもあるか（API の必須条件と同じ判定）。 */
export function hasArea(criteria: RecommendCriteria): boolean {
  return (
    criteria.prefectures.length > 0 ||
    criteria.municipality.length > 0 ||
    criteria.operators.length > 0 ||
    criteria.routes.length > 0 ||
    criteria.routeTypes.length > 0
  )
}

/** 既定と違う重みだけを「指標名:重み」で並べる（同じなら送らない＝URL が短くなる）。 */
function weightsParam(criteria: RecommendCriteria): string {
  const defaults = RECOMMEND_PRESETS[criteria.preset].metrics
  const changed = defaults.flatMap((metric) => {
    const value = criteria.weights[metric.metric]
    if (value === undefined) return []
    const rounded = quantizeWeight(value)
    return rounded === metric.weight ? [] : [`${metric.metric}:${rounded}`]
  })
  return changed.join(',')
}

/** 災害の方針に応じて、要るパラメータだけを足す（使わない値を URL に載せない）。 */
function hazardParams(criteria: RecommendCriteria): readonly (readonly [string, string])[] {
  if (criteria.hazard === 'off') return [['hazard', 'off']]
  const group: readonly [string, string] = ['hazardGroup', criteria.hazardGroup]
  return criteria.hazard === 'exclude'
    ? [['hazard', 'exclude'], group, ['hazardAtOrAbove', criteria.hazardAtOrAbove]]
    : [['hazard', 'penalty'], group, ['hazardPenalty', criteria.hazardPenalty]]
}

/** 条件 → リクエスト URL。絞り込みが無ければ `null`（＝取得しない）。 */
export function recommendUrl(criteria: RecommendCriteria): string | null {
  if (!hasArea(criteria)) return null
  const params = new URLSearchParams({
    preset: criteria.preset,
    radiusM: String(criteria.radiusM),
    method: criteria.method,
    flagged: criteria.flagged,
    topN: String(criteria.topN),
    limit: String(RESULT_LIMIT),
  })
  if (criteria.municipality.length > 0) params.set('municipality', criteria.municipality)
  if (criteria.prefectures.length > 0) params.set('prefecture', criteria.prefectures.join(','))
  if (criteria.operators.length > 0) params.set('operators', criteria.operators.join(','))
  if (criteria.routes.length > 0) params.set('routes', criteria.routes.join(','))
  if (criteria.routeTypes.length > 0) params.set('routeTypes', criteria.routeTypes.join(','))
  const weights = weightsParam(criteria)
  if (weights.length > 0) params.set('weights', weights)
  for (const [key, value] of hazardParams(criteria)) params.set(key, value)
  return `/api/recommend?${params.toString()}`
}
