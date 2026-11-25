/**
 * ドメイン：区域の値の**作り方**の名前と、区域の種類ごとの作り方の決め方（純関数・2026-10-10 B5b）。
 *
 * 人口などの 4 系統（`totals.ts`）と年齢の 2 系統（`age-totals.ts`・2026-11-25）が同じ名前で名乗る。
 */

import { type AreaMetric } from '@/shared/area-catalog'
import { type AreaTotalMethod } from '@/shared/area-summary'

export const METHOD_LABELS_JA: Readonly<Record<AreaTotalMethod, string>> = {
  official: '公表値',
  projection: '推計（市区町村ごとの合計）',
  officialAndProjection: '公表値と推計',
  mesh: 'メッシュの按分',
  stationRadius: '駅の円の値（メッシュの按分）',
}

/** 区域の種類ごとの作り方と出典（行政区域・沿線はカタログ、駅から N m は駅の指標の出典）。 */
export type MethodOf = (metric: AreaMetric) => {
  readonly method: AreaTotalMethod
  readonly sourceJa: string
}
