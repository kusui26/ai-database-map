/**
 * エリアの言い方の解決に使うデータ（本番の依存・2026-10-08 B2）。
 *
 * 全駅の索引（`station_catalog()`・名前・都道府県・市区町村・座標）から作り、サーバの中で 1 時間持つ
 * （データの更新でしか変わらない・読めなかったときは持たない）。市区町村も起点の駅名も同じ索引で引く。
 */

import { stationCatalog } from '@/db/queries'
import { ttlCache } from '@/lib/ttl-cache'
import { buildAreaIndex } from './place-index'
import { type AreaResolveDeps } from './resolve'

const INDEX_TTL_MS = 60 * 60 * 1000

const indexCache = ttlCache(async () => buildAreaIndex(await stationCatalog()), INDEX_TTL_MS)

/** ツールが使う依存（索引はキャッシュから）。 */
export function areaDeps(): AreaResolveDeps {
  return { index: () => indexCache.get() }
}

/** キャッシュを捨てる（テストと、データを入れ替えたあとの読み直し）。 */
export function clearAreaCache(): void {
  indexCache.clear()
}
