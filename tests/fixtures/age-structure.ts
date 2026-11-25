/**
 * 年齢別の人口の見本（2026-11-25・人口の年齢 PR-3）。数は本番の build（2026-11-24）の値そのもの：
 * 武蔵小杉の 1km 圏（年齢不詳が少ない駅）と、矢場町の 1km 圏（2020 年の年齢不詳 30.4%・⚠ が立つ駅）。
 * 区分の和は既存の総数の列（`pop_2015_1km`・`pop_2020_1km`・`pop_pred_2024_<年>_1km`）と 1 人単位で同じ。
 */

import { type StationRow } from '@/shared/api'
import { type AgeProfileRow } from '@/db/queries'

/** 年齢の表の年（2015・2020 は国勢調査、2025 からは R6 推計）。 */
export const AGE_YEARS = [2015, 2020, 2025, 2030, 2035, 2040, 2045, 2050] as const
const FIRST_PROJECTED_YEAR = 2025

type YearCounts = { readonly counts: readonly number[]; readonly unknown: number | null }

/** 武蔵小杉 1km 圏（年 → 0〜14・15〜64・65〜74・75 歳以上と、補う前の年齢不詳）。 */
export const KOSUGI_1KM: Readonly<Record<number, YearCounts>> = {
  2015: { counts: [8457, 50532, 4846, 3752], unknown: 1091 },
  2020: { counts: [9965, 55863, 5055, 4535], unknown: 2325 },
  2025: { counts: [9759, 53522, 4821, 5356], unknown: null },
  2030: { counts: [9490, 54685, 6007, 5890], unknown: null },
  2035: { counts: [9197, 55027, 7735, 6431], unknown: null },
  2040: { counts: [9252, 54103, 9370, 7575], unknown: null },
  2045: { counts: [9255, 53021, 9873, 9192], unknown: null },
  2050: { counts: [9175, 51822, 9329, 11239], unknown: null },
}

/** 矢場町 1km 圏（2020 年の年齢不詳 9,301 人＝30.4%）。 */
export const YABACHO_1KM: Readonly<Record<number, YearCounts>> = {
  2015: { counts: [1490, 19358, 3057, 2978], unknown: 1466 },
  2020: { counts: [1640, 22590, 2921, 3434], unknown: 9301 },
  2025: { counts: [1714, 20909, 2258, 3380], unknown: null },
  2030: { counts: [1866, 19857, 2413, 3395], unknown: null },
  2035: { counts: [1898, 18795, 2973, 3305], unknown: null },
  2040: { counts: [1749, 18033, 3382, 3415], unknown: null },
  2045: { counts: [1625, 17465, 3335, 3786], unknown: null },
  2050: { counts: [1523, 16917, 3100, 4235], unknown: null },
}

/** 年 → 区分の表 → DB の関数の行（1 つの半径・年の昇順）。 */
export function ageRowsOf(
  radiusM: number,
  byYear: Readonly<Record<number, YearCounts>>,
): AgeProfileRow[] {
  return AGE_YEARS.map((year) => {
    const at = byYear[year]
    if (at === undefined) throw new Error(`見本に ${year} 年がありません`)
    return {
      radiusM,
      year,
      projected: year >= FIRST_PROJECTED_YEAR,
      counts: [...at.counts],
      unknown: at.unknown,
    }
  })
}

/** 年ごとの 4 区分の和。 */
export function totalsOf(byYear: Readonly<Record<number, YearCounts>>): number[] {
  return AGE_YEARS.map((year) =>
    (byYear[year]?.counts ?? []).reduce((sum, count) => sum + count, 0),
  )
}

/** 武蔵小杉の値の表（1km 圏・チップと注意が読む指標とフラグ・本番の値）。 */
export const KOSUGI_VALUES_1KM: Readonly<Record<string, number>> = {
  pop_2015_1km: 67587,
  pop_2020_1km: 75418,
  pop_gr_2020_2015_1km: 11.6,
  pop_lowbase_2015_1km: 0,
  pop_pred_2024_2025_1km: 73458,
  pop_pred_2024_2050_1km: 81565,
  pop_gr_pred_2024_2025_1km: -2.6,
  pop_gr_pred_2024_2050_1km: 8.2,
  pop_lowbase_2020_1km: 0,
  pop15_64_2020_1km: 55863,
  pop15_64_share_2020_1km: 74.1,
  pop65_share_2020_1km: 12.7,
  pop75_share_2020_1km: 6.0,
  pop0_14_share_2020_1km: 13.2,
  pop15_64_gr_2020_2015_1km: 10.5,
  pop15_64_gr_pred_2024_2030_1km: -2.1,
  pop15_64_gr_pred_2024_2040_1km: -3.2,
  pop15_64_gr_pred_2024_2050_1km: -7.2,
  pop65_gr_pred_2024_2050_1km: 114.5,
  pop65_share_pred_2024_2050_1km: 25.2,
  pop65_lowbase_2020_1km: 0,
  pop_ageunk_2020_1km: 0,
}

/** 矢場町の値の表（1km 圏・年齢不詳 ⚠ が立つ）。 */
export const YABACHO_VALUES_1KM: Readonly<Record<string, number>> = {
  ...KOSUGI_VALUES_1KM,
  pop_2015_1km: 26883,
  pop_2020_1km: 30585,
  pop_gr_2020_2015_1km: 13.8,
  pop_pred_2024_2050_1km: 25775,
  pop_gr_pred_2024_2050_1km: -15.7,
  pop15_64_2020_1km: 22590,
  pop15_64_share_2020_1km: 73.9,
  pop65_share_2020_1km: 20.8,
  pop15_64_gr_pred_2024_2050_1km: -25.1,
  pop65_gr_pred_2024_2050_1km: 15.4,
  pop65_share_pred_2024_2050_1km: 28.5,
  pop_ageunk_2020_1km: 1,
}

export const KOSUGI_STATION: StationRow = {
  grp: '武蔵小杉#0',
  stationName: '武蔵小杉',
  label: '武蔵小杉',
  searchLabel: '武蔵小杉（神奈川県）',
  prefecture: '神奈川県',
  municipality: '川崎市中原区',
  lon: 139.6594,
  lat: 35.5763,
  nOp: 2,
  operators: '東日本旅客鉄道・東急電鉄',
  paxLatest: 400_000,
  lpNearUse: '商業地',
  levelComplete: true,
}
