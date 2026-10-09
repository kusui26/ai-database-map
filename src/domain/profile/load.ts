/**
 * ドメイン：駅周辺のプロフィールを**一続きで**作る（解決 → 取得 → 組み立て・2026-10-09 B4）。
 *
 * このファイルだけが非純粋（DB を読む）。共通 API（`/api/stations/[grp]/profile`）と AI のツール（`getStationProfile`）は
 * ここを 1 回呼ぶだけでよい——順番と往復の回数を呼び出し側に持たせると、画面とチャットで別の答えになりうる。
 *
 * 往復は駅 1 回＋並列 3 回：駅の属性 → （値の束・県内／市内の順位・災害の事前計算）。どれも 1 駅ぶんで軽い（順位は約 50ms）。
 */

import {
  stationBundle,
  stationByGrp,
  stationHazardSummaries,
  stationProfileRanks,
} from '@/db/queries'
import { type StationProfile } from '@/shared/api'
import { type RadiusM } from '@/shared/constants'
import { buildStationProfile, comparisonAreaOf } from './build'
import { rankedKeys, resolveProfileSections } from './items'

/** 駅（grp）× 半径 → プロフィール。知らない駅は null（呼び出し側が 404・構造化エラーにする）。 */
export async function loadStationProfile(
  grp: string,
  radiusM: RadiusM,
): Promise<StationProfile | null> {
  const station = await stationByGrp(grp)
  if (station === null) return null
  const sections = resolveProfileSections(radiusM)
  const area = comparisonAreaOf(station.municipality)
  const [values, ranks, hazardRows] = await Promise.all([
    stationBundle(grp),
    stationProfileRanks(grp, rankedKeys(sections), area),
    stationHazardSummaries([grp]),
  ])
  const hazard = hazardRows.find((row) => row.grp === grp)?.summary ?? null
  return buildStationProfile({ station, radiusM, sections, values, ranks, area, hazard })
}
