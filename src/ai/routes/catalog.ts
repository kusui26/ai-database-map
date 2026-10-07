/**
 * 会社・路線の名前解決に使うデータ（本番の依存・2026-10-07・B1）。
 *
 * - 照合の索引：路線の一覧（`route_names()`）と会社の一覧（`operator_names()`）から作る。データの更新でしか
 *   変わらないので、サーバの中で 1 時間持つ（共通 API の `/api/routes` も 1 日キャッシュ）。読めなかったときは持たない
 * - 候補の駅：同じ名前の路線を都道府県で絞る・候補を見せるときだけ、駅の一覧（`list_stations`）で数える
 *   （会社の営業エリアでは粗い。JR 東海は新大阪に駅があるので、会社単位だと大阪の「中央線」に残ってしまう）
 */

import { listStations, operatorNames, routeNames } from '@/db/queries'
import { type RoutePair } from './aliases'
import { buildNameIndex, type NameIndex } from './match'
import { type NameResolveDeps, type PairStations } from './resolve'

const INDEX_TTL_MS = 60 * 60 * 1000
/** 1 本の路線の駅は多くても 200 未満。`list_stations` の上限と同じ値にしておく。 */
const STATIONS_LIMIT = 2000

type CacheEntry = { readonly loadedAt_ms: number; readonly index: Promise<NameIndex> }

const cache: { entry: CacheEntry | null } = { entry: null }

async function loadIndex(): Promise<NameIndex> {
  const [routes, operators] = await Promise.all([routeNames(), operatorNames()])
  return buildNameIndex({ routes, operators })
}

function cachedIndex(now_ms: number): Promise<NameIndex> {
  const entry = cache.entry
  if (entry !== null && now_ms - entry.loadedAt_ms < INDEX_TTL_MS) return entry.index
  const index = loadIndex()
  cache.entry = { loadedAt_ms: now_ms, index }
  // 失敗は持たない（次の呼び出しで読み直す）。呼び出し側へは元の失敗がそのまま届く。
  index.catch(() => {
    if (cache.entry?.index === index) cache.entry = null
  })
  return index
}

async function stationsOf(
  pairs: readonly RoutePair[],
  prefectures: readonly string[],
): Promise<PairStations> {
  const rows = await listStations({
    operators: [...new Set(pairs.map((pair) => pair.operator))],
    routes: [...new Set(pairs.map((pair) => pair.route))],
    prefectures,
    limit: STATIONS_LIMIT,
  })
  return { count: rows.length, prefectures: [...new Set(rows.map((row) => row.prefecture))] }
}

/** ツールが使う依存（索引はキャッシュから・駅は DB から）。 */
export function routeNameDeps(): NameResolveDeps {
  return { index: () => cachedIndex(Date.now()), stationsOf }
}

/** キャッシュを捨てる（テストと、データを入れ替えたあとの読み直し）。 */
export function clearRouteNameCache(): void {
  cache.entry = null
}
