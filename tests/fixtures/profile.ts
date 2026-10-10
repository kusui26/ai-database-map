/**
 * 駅周辺のプロフィールの見本（2026-10-09 B4）。値は 2026-10-09 の本番 DB の横浜駅（1km・500m 圏）。
 * ドメイン・共通 API のルート・AI のツールのテストが共有する（同じ駅の同じ値で、経路ごとの違いだけを見る）。
 */

import { type StationRow } from '@/shared/api'
import { type StationHazardSummary } from '@/shared/hazard-summary'
import { type ProfileRankRow } from '@/db/queries'

export const YOKOHAMA: StationRow = {
  grp: '横浜#0',
  stationName: '横浜',
  label: '横浜',
  searchLabel: '横浜（神奈川県）',
  prefecture: '神奈川県',
  municipality: '横浜市西区',
  lon: 139.62198,
  lat: 35.46578,
  nOp: 6,
  operators: '東日本旅客鉄道・東急電鉄',
  paxLatest: 1_936_287,
  lpNearUse: '商業地',
  levelComplete: true,
}

/** 1km 圏の値（2026-10-09 の本番 DB の横浜駅）。 */
export const VALUES_1KM: Readonly<Record<string, number>> = {
  pop_2020_1km: 43_471,
  pop_gr_2020_2015_1km: 5.3,
  pop_gr_pred_2024_2040_1km: 7.6,
  inc_pc_2025_1km: 463.7,
  inc_city_only_1km: 1,
  lp_med_2026_1km: 1_735_000,
  lp_gr_2026_2021_1km: 58.7,
  emp_n_2021_1km: 179_031,
  estab_n_2021_1km: 6_998,
  sales_dest_2021_1km: 5_573.1,
  pax_2024: 1_936_287,
  bus_n_1km: 28,
}

/** 500m 圏の値（地価の増減率は 500m が無い＝1km の値を使う）。 */
export const VALUES_500M: Readonly<Record<string, number>> = {
  pop_2020_500m: 4_881,
  pop_gr_2020_2015_500m: 4.5,
  pop_gr_pred_2024_2040_500m: 3.6,
  inc_pc_2025_500m: 463.7,
  lp_med_2026_500m: 4_200_000,
  emp_n_2021_500m: 75_667,
  estab_n_2021_500m: 3_158,
  sales_dest_2021_500m: 2_762.1,
  bus_n_500m: 10,
}

export function rank(
  prefRank: number,
  prefTotal: number,
  area: [number, number] | null,
): ProfileRankRow {
  return {
    key: '',
    prefRank,
    prefTotal,
    areaRank: area === null ? null : area[0],
    areaTotal: area === null ? null : area[1],
  }
}

/** key → 順位（どの key にも同じ順位を返す。個別に見たい key は上書きする）。 */
export function ranksFor(
  keys: readonly string[],
  base: ProfileRankRow,
  overrides: Readonly<Record<string, ProfileRankRow>> = {},
): Map<string, ProfileRankRow> {
  return new Map(keys.map((key) => [key, { ...(overrides[key] ?? base), key }]))
}

export const HAZARD: StationHazardSummary = {
  grp: '横浜#0',
  level: 'warning',
  evacuation: 'vertical',
  headlineJa: 'この場所は、洪水浸水想定区域（想定最大規模）に入っています（0.5〜3m 未満）。',
  certainty: 'partial',
  elevationM: 7.7,
  groups: {
    flood: {
      level: 'warning',
      worstJa: '洪水浸水想定区域（想定最大規模）：0.5〜3m 未満',
      nearby: true,
      uncovered: false,
    },
    inland_flood: { level: 'none', worstJa: null, nearby: true, uncovered: false },
    storm_surge: { level: 'none', worstJa: null, nearby: false, uncovered: false },
    tsunami: {
      level: 'caution',
      worstJa: '津波浸水想定：0〜0.3m 未満',
      nearby: false,
      uncovered: false,
    },
    landslide: { level: 'none', worstJa: null, nearby: false, uncovered: true },
  },
}
