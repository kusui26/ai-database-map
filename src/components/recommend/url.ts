'use client'

/**
 * おすすめの条件を **URL に載せる**（`nuqs`・§13.7 W5）。
 *
 * 狙いは 3 つ。**①共有できる**——「この条件で見て」をリンクで送れる。**②再現できる**——
 * 同じ URL なら同じ順位になる（重みも足切りも URL に入っているので）。**③閉じても消えない**——
 * モーダルの中身は閉じるたびに unmount されるが、条件は URL に残る。
 *
 * ## 既定は URL に書かない
 *
 * `withDefault` と組にすると、既定と同じ値は自動で消える（nuqs の `clearOnDefault`）。
 * 既定だらけの長い URL は読めないし、「何を変えたのか」が分からなくなる。
 *
 * ## 読むのは開いたときだけ
 *
 * 書き込みは `history: 'replace'` なので、戻る/進むで条件の途中に戻ることはない。
 * だから中身は「開いたときに URL から読む → 以後は書くだけ」で足りる（双方向にしない）。
 */

import { parseAsInteger, parseAsString } from 'nuqs'
import { RECOMMEND_OPEN_PARAM } from './openParam'
import {
  toFlagged,
  toGroup,
  toHazardMode,
  toLevel,
  toList,
  toMethod,
  toNumberList,
  toPenalty,
  toPreset,
  toRadiusM,
  toWeights,
} from './parse'
import { changedWeightsParam, DEFAULT_CRITERIA, type RecommendCriteria } from './query'

/**
 * 条件のパラメータ。接頭辞 `rec` は**衝突を避けるため**——同じ URL に地図（`grp` `r`）と
 * ハザードレイヤ（`hz` `hzop`）が同居している。
 */
export const RECOMMEND_PARSERS = {
  recPref: parseAsString.withDefault(''),
  recMuni: parseAsString.withDefault(''),
  recOps: parseAsString.withDefault(''),
  recRoutes: parseAsString.withDefault(''),
  recTypes: parseAsString.withDefault(''),
  recPreset: parseAsString.withDefault(DEFAULT_CRITERIA.preset),
  recW: parseAsString.withDefault(''),
  recRadius: parseAsInteger.withDefault(DEFAULT_CRITERIA.radiusM),
  recNorm: parseAsString.withDefault(DEFAULT_CRITERIA.method),
  recHazard: parseAsString.withDefault(DEFAULT_CRITERIA.hazard),
  recGroup: parseAsString.withDefault(DEFAULT_CRITERIA.hazardGroup),
  recLevel: parseAsString.withDefault(DEFAULT_CRITERIA.hazardAtOrAbove),
  recPenalty: parseAsString.withDefault(DEFAULT_CRITERIA.hazardPenalty),
  recFlag: parseAsString.withDefault(DEFAULT_CRITERIA.flagged),
}

/** モーダルを開いているか（共有リンクを踏んだら開いた状態で始まる）。 */
export { RECOMMEND_OPEN_PARAM }

export type RecommendUrlValues = {
  readonly recPref: string
  readonly recMuni: string
  readonly recOps: string
  readonly recRoutes: string
  readonly recTypes: string
  readonly recPreset: string
  readonly recW: string
  readonly recRadius: number
  readonly recNorm: string
  readonly recHazard: string
  readonly recGroup: string
  readonly recLevel: string
  readonly recPenalty: string
  readonly recFlag: string
}

/** URL → 条件。知らない値は既定に倒す（`parse.ts`）。 */
export function criteriaFromUrl(values: RecommendUrlValues): RecommendCriteria {
  return {
    prefectures: toList(values.recPref),
    municipality: values.recMuni,
    operators: toList(values.recOps),
    routes: toList(values.recRoutes),
    routeTypes: toNumberList(values.recTypes),
    preset: toPreset(values.recPreset),
    weights: toWeights(values.recW),
    radiusM: toRadiusM(values.recRadius),
    method: toMethod(values.recNorm),
    hazard: toHazardMode(values.recHazard),
    hazardGroup: toGroup(values.recGroup),
    hazardAtOrAbove: toLevel(values.recLevel),
    hazardPenalty: toPenalty(values.recPenalty),
    flagged: toFlagged(values.recFlag),
    topN: DEFAULT_CRITERIA.topN,
  }
}

/** 条件 → URL。既定と同じ値は nuqs が自動で消す（`withDefault` と組）。 */
export function criteriaToUrl(criteria: RecommendCriteria): RecommendUrlValues {
  return {
    recPref: criteria.prefectures.join(','),
    recMuni: criteria.municipality,
    recOps: criteria.operators.join(','),
    recRoutes: criteria.routes.join(','),
    recTypes: criteria.routeTypes.join(','),
    recPreset: criteria.preset,
    recW: changedWeightsParam(criteria),
    recRadius: criteria.radiusM,
    recNorm: criteria.method,
    recHazard: criteria.hazard,
    recGroup: criteria.hazardGroup,
    recLevel: criteria.hazardAtOrAbove,
    recPenalty: criteria.hazardPenalty,
    recFlag: criteria.flagged,
  }
}
