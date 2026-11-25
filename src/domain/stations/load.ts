/**
 * ドメイン：駅詳細を**一続きで**作る（取得 → 組み立て・2026-11-25）。
 *
 * このファイルだけが非純粋（DB を読む）。共通 API（`/api/stations/[grp]`）と AI のツール（`getStationDetail`・MCP の
 * `get_station_detail`）はここを 1 回呼ぶだけでよい——往復の順番と回数を呼び出し側に持たせると、画面とチャットで別の答えに
 * なりうる（`profile/load.ts` と同じ作法）。往復は駅 1 回＋並列 2 回（値の束・年齢別の人口）。
 */

import { stationAgeProfile, stationBundle, stationByGrp } from '@/db/queries'
import { type StationDetail } from '@/shared/api'
import { buildStationDetail } from './presenter'

/**
 * 駅（grp）→ 駅詳細（全半径の系列と年齢別の人口）。知らない駅は null（呼び出し側が 404・構造化エラーにする）。
 * 年齢の表を引けないときも駅詳細ごと失敗させる（`profile/load.ts` の災害と同じ）——握りつぶして `ageStructure: null` で
 * 返すと、年齢の図の無い応答が CDN に 1 時間残り（`CACHE.hour`）、失敗も見えなくなる。
 */
export async function loadStationDetail(grp: string): Promise<StationDetail | null> {
  const station = await stationByGrp(grp)
  if (station === null) return null
  const [values, ageRows] = await Promise.all([stationBundle(grp), stationAgeProfile(grp)])
  return buildStationDetail(station, values, ageRows)
}
