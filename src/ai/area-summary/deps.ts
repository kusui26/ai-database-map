/**
 * `getAreaSummary` の名前の解決に使うデータ（本番の依存・2026-10-11 B5d）。
 *
 * 全区域の索引は、エリアの一覧（`area_catalog`）と全駅の索引（`station_catalog`・地図の範囲で決めるための駅の座標）から作り、
 * サーバの中で 1 時間持つ（データの更新でしか変わらない・読めなかったときは持たない）。起点の駅は B2 の駅の索引、
 * 路線は L3 の名前の索引をそのまま使う。
 */

import { areaCatalogRows, stationCatalog } from '@/db/queries'
import { ttlCache } from '@/lib/ttl-cache'
import { areaDeps } from '@/ai/area/catalog'
import { routeNameDeps } from '@/ai/routes/catalog'
import { resolveNameFilters } from '@/ai/routes/resolve'
import { buildAdminIndex } from './admin-index'
import { type SummaryAreasDeps } from './resolve'

const ADMIN_INDEX_TTL_MS = 60 * 60 * 1000

const adminIndexCache = ttlCache(async () => {
  const [rows, stations] = await Promise.all([areaCatalogRows(), stationCatalog()])
  return buildAdminIndex(rows, stations)
}, ADMIN_INDEX_TTL_MS)

/** ツールが使う依存（索引はキャッシュから）。 */
export function summaryAreasDeps(): SummaryAreasDeps {
  return {
    adminIndex: () => adminIndexCache.get(),
    stationIndex: () => areaDeps().index(),
    resolveLines: (request) => resolveNameFilters(request, routeNameDeps()),
  }
}

/** キャッシュを捨てる（テストと、データを入れ替えたあとの読み直し）。 */
export function clearAdminIndexCache(): void {
  adminIndexCache.clear()
}
