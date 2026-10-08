/**
 * 会社・路線の名前の解決に使うデータ（本番の依存・2026-10-07 B1 → 2026-10-08 L3）。
 *
 * - 照合の索引：路線（運行系統）の一覧（`line_names()`）・会社の一覧（`operator_names()`）・法令上の路線の一覧
 *   （`route_names()`・会社名を含むのが正式名かを見る）から作る。データの更新でしか変わらないので、サーバの中で
 *   1 時間持つ（共通 API の `/api/lines` は 1 日キャッシュ）。読めなかったときは持たない
 * - 駅：候補を見せるとき・同じ名前の路線を地図の範囲で決めるときだけ、駅の一覧（`list_stations`・共通の述語）で数える
 */

import { lineNames, listStations, operatorNames, routeNames } from '@/db/queries'
import { type Viewport } from '@/shared/viewport'
import { buildNameIndex, type NameIndex } from './match'
import { type NameResolveDeps } from './resolve'

const INDEX_TTL_MS = 60 * 60 * 1000
/** 束ねた路線の駅は多くても 300 未満（JR東海道本線の全区間）。PostgREST の行の上限（1,000）より下に置く。 */
const STATIONS_LIMIT = 1000

type CacheEntry = { readonly loadedAt_ms: number; readonly index: Promise<NameIndex> }

const cache: { entry: CacheEntry | null } = { entry: null }

async function loadIndex(): Promise<NameIndex> {
  const [lines, operators, legalRoutes] = await Promise.all([
    lineNames(),
    operatorNames(),
    routeNames(),
  ])
  return buildNameIndex({ lines, operators, legalRoutes })
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

async function countStations(lineCds: readonly number[]): Promise<number> {
  const rows = await listStations({ lines: lineCds, limit: STATIONS_LIMIT })
  return rows.length
}

async function hasStationsIn(lineCds: readonly number[], viewport: Viewport): Promise<boolean> {
  const rows = await listStations({ lines: lineCds, bbox: viewport, limit: 1 })
  return rows.length > 0
}

/** ツールが使う依存（索引はキャッシュから・駅は DB から）。 */
export function routeNameDeps(): NameResolveDeps {
  return { index: () => cachedIndex(Date.now()), countStations, hasStationsIn }
}

/** キャッシュを捨てる（テストと、データを入れ替えたあとの読み直し）。 */
export function clearRouteNameCache(): void {
  cache.entry = null
}
