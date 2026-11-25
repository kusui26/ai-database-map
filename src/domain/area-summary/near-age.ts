/**
 * ドメイン：駅から N m のエリアの**年齢**（純関数・2026-11-25・`docs/261122_PLAN_population_improvement.md` §8.3）。
 *
 * 駅から N m の区域の値は、起点の駅の円の値（`build.ts`）。人口・推計は駅の指標の同じ名前の列から読むが、年齢の 4 区分の
 * 人数は駅の指標に無い（駅の指標は 15〜64 歳の人数と割合・増減率だけ）。そこで駅詳細の人口タブと同じ駅の年齢の表
 * （`station_age_profile`・半径 × 年 × 4 区分）から、その半径の 8 年を区域の指標の key へ読み替える。
 */

import { type AgeProfileRow } from '@/db/queries'
import { type AgeBand, AGE_BANDS } from '@/shared/api'
import {
  type AreaAgeBase,
  areaMetricsOf,
  isProjectedAreaMetric,
  type AreaMetric,
} from '@/shared/area-catalog'
import { type RadiusM } from '@/shared/constants'

/** 駅の年齢の区分 → 区域の年齢の系統（漏れは型で落ちる）。 */
const BAND_BASES: Readonly<Record<AgeBand, AreaAgeBase>> = {
  '0_14': 'pop0_14',
  '15_64': 'pop15_64',
  '65_74': 'pop65_74',
  '75plus': 'pop75',
}

/** 駅の年齢の表の出典を持つ駅の指標の頭（実績・推計で 1 つずつ。年齢の 4 区分の列は駅の指標に無いので代わりに名乗る）。 */
const AGE_SOURCE_HEADS = {
  actual: 'pop15_64_2020',
  projection: 'pop65_share_pred_2024_2050',
} as const

/** 区域の年齢の指標の、出典に使う駅の指標の頭（`pop15_64_2020` か `pop65_share_pred_2024_2050`）。 */
export function ageSourceHeadOf(metric: AreaMetric): string {
  return isProjectedAreaMetric(metric) ? AGE_SOURCE_HEADS.projection : AGE_SOURCE_HEADS.actual
}

/** 区域の年齢の指標の key（系統・年 → key・無ければ undefined）。 */
function ageMetricKey(base: AreaAgeBase, year: number): string | undefined {
  return areaMetricsOf(base).find((metric) => metric.year === year)?.key
}

/** 駅の年齢の表（全半径・全年）→ その半径の、区域の年齢の指標の key と値（`pop15_64_2020`・`pop75_pred_2024_2050` …）。 */
export function ageCircleValues(
  rows: readonly AgeProfileRow[],
  radiusM: RadiusM,
): [string, number][] {
  return rows
    .filter((row) => row.radiusM === radiusM)
    .flatMap((row) =>
      AGE_BANDS.flatMap((band, index): [string, number][] => {
        const key = ageMetricKey(BAND_BASES[band], row.year)
        const count = row.counts[index]
        return key === undefined || count === undefined ? [] : [[key, count]]
      }),
    )
}
