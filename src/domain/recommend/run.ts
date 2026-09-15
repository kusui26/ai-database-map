/**
 * ドメイン：**一続きで走らせる**（解決 → 取得 → 合成）。
 *
 * 呼ぶ側（`/api/recommend`）はここを 1 回叩くだけでよい。順番と往復の回数を呼び出し側に
 * 持たせない——持たせると、画面とチャットで別の順番になりうる。
 *
 * 返すのは順位だけではない。**埋めた既定（`notes`）・解決できなかった指定（`unresolved`）・
 * 集めた駅そのもの（`gathered`）**も一緒に返す。脚注に書くものが揃っていないと、
 * 出てきた順位は読めない。
 *
 * ## 「多すぎる」は結果の一種として返す
 *
 * 上限を超えたときに例外を投げると、ドメインが HTTP の都合（400）を知ることになる。
 * 判別可能な union で返し、**status を決めるのはルートの仕事**にしておく。
 */

import type { ListStationsFilter } from '@/db/queries'
import { gatherCandidates, type GatheredCandidates } from './gather'
import { recommendStations } from './index'
import { resolveMetrics } from './metrics'
import type { PresetMetric } from './presets'
import type {
  FlaggedPolicy,
  HazardPolicy,
  NormalizeMethod,
  RecommendResult,
  ScoredMetric,
} from './types'

export type RecommendRunInput = {
  /** 対象集合の絞り込み（市区町村・路線・bbox…）。 */
  readonly filter: ListStationsFilter
  /** プリセット（ファミリ名か正確な key ＋ 向き ＋ 重み）。 */
  readonly specs: readonly PresetMetric[]
  /** ファミリ名を解決するときの半径（m）。 */
  readonly radiusM: number
  readonly method: NormalizeMethod
  readonly hazard: HazardPolicy
  readonly flagged?: FlaggedPolicy
  readonly topN?: number
  /** 候補集合の上限（超えたら `too-many`）。 */
  readonly maxStations: number
}

export type RecommendRunOk = {
  readonly kind: 'ok'
  readonly result: RecommendResult
  /** 解決後の指標（表の列順）。半径・年はここで確定している。 */
  readonly metrics: readonly ScoredMetric[]
  /** 集めたもの（駅の素性・災害サマリ）。表と地図と脚注がここから作れる。 */
  readonly gathered: GatheredCandidates
  /** 半径・年の既定を埋めた記録（脚注へ）。 */
  readonly notes: readonly string[]
  /** カタログに無くて使えなかった指定。 */
  readonly unresolved: readonly string[]
}

export type RecommendRun =
  RecommendRunOk | { readonly kind: 'too-many'; readonly maxStations: number }

/** 解決 → 取得 → 合成を 1 回で。DB を読むので非純粋。 */
export async function runRecommendation(input: RecommendRunInput): Promise<RecommendRun> {
  const { metrics, notes, unresolved } = resolveMetrics(input.specs, input.radiusM)
  const gathered = await gatherCandidates(input.filter, metrics, {
    includeHazard: input.hazard.mode !== 'off',
    maxStations: input.maxStations,
  })
  if (gathered.overLimit) return { kind: 'too-many', maxStations: input.maxStations }
  const result = recommendStations(gathered.candidates, {
    metrics,
    method: input.method,
    hazard: input.hazard,
    ...(input.flagged === undefined ? {} : { flagged: input.flagged }),
    ...(input.topN === undefined ? {} : { topN: input.topN }),
  })
  return { kind: 'ok', result, metrics, gathered, notes, unresolved }
}
