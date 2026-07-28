/**
 * RPC / select の型付きラッパ（DB 由来の snake_case を camelCase に整える）。
 * 結果は Zod で検証してから返す（DB 形状ドリフトの防御）。domain には依存しない（下位層）。
 */

import { z } from 'zod'
import { type StationRow, type StationSummary } from '@/shared/api'
import { db, DbError } from './client'

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new DbError(error.message)
  return data
}

/** RPC を呼び、行配列を Zod 検証して返す。 */
async function rpcRows<T>(
  fn: string,
  args: Record<string, unknown>,
  rowSchema: z.ZodType<T>,
): Promise<T[]> {
  return z.array(rowSchema).parse(await rpc(fn, args))
}

// --- 検索・空間 ---------------------------------------------------------
const summaryRowSchema = z.object({
  grp: z.string(),
  station_name: z.string(),
  label: z.string().optional(),
  search_label: z.string().optional(), // search_stations のみ返す
  prefecture: z.string(),
  lon: z.number(),
  lat: z.number(),
  pax_latest: z.number().nullable().optional(),
  dist_m: z.number().optional(),
})

function toSummary(row: z.infer<typeof summaryRowSchema>): StationSummary {
  return {
    grp: row.grp,
    stationName: row.station_name,
    label: row.label ?? row.station_name,
    prefecture: row.prefecture,
    lon: row.lon,
    lat: row.lat,
    paxLatest: row.pax_latest ?? null,
    ...(row.search_label === undefined ? {} : { searchLabel: row.search_label }),
    ...(row.dist_m === undefined ? {} : { distM: row.dist_m }),
  }
}

export async function searchStations(q: string): Promise<StationSummary[]> {
  return (await rpcRows('search_stations', { q }, summaryRowSchema)).map(toSummary)
}

export async function stationsInBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  lim = 2000,
): Promise<StationSummary[]> {
  const rows = await rpcRows(
    'stations_in_bbox',
    { west, south, east, north, lim },
    summaryRowSchema,
  )
  return rows.map(toSummary)
}

export async function nearestStations(lon: number, lat: number, k = 10): Promise<StationSummary[]> {
  const rows = await rpcRows('nearest_stations', { in_lon: lon, in_lat: lat, k }, summaryRowSchema)
  return rows.map(toSummary)
}

// --- ランキング ---------------------------------------------------------
const rankRowSchema = z.object({
  grp: z.string(),
  station_name: z.string(),
  prefecture: z.string(),
  value: z.number(),
  flag_value: z.number().nullable(),
  rank: z.number(),
  total: z.number(),
})

/** buildRanking の入力（RankRawRow）と構造一致。 */
export type RankRow = {
  grp: string
  stationName: string
  prefecture: string
  value: number
  flagValue: number | null
  rank: number
}

/** rank_by_column の1ページ（rows＋フィルタ後の総件数）。 */
export async function rankByColumn(
  columnKey: string,
  prefectures: string[],
  order: 'asc' | 'desc',
  limit: number,
  offset: number,
  excludeLowN: boolean,
): Promise<{ rows: RankRow[]; total: number }> {
  const args = {
    column_key: columnKey,
    prefs: prefectures.length > 0 ? prefectures : null, // 空は null＝全国（PostgREST の空配列回避）
    dir: order,
    lim: limit,
    off: offset,
    exclude_lown: excludeLowN,
  }
  const raw = await rpcRows('rank_by_column', args, rankRowSchema)
  return {
    total: raw[0]?.total ?? 0,
    rows: raw.map((r) => ({
      grp: r.grp,
      stationName: r.station_name,
      prefecture: r.prefecture,
      value: r.value,
      flagValue: r.flag_value,
      rank: r.rank,
    })),
  }
}

// --- 散布（複数指標の縦持ち） -------------------------------------------
const valueRowSchema = z.object({
  grp: z.string(),
  station_name: z.string(),
  key: z.string(),
  value: z.number(),
})

/** buildGrowth の入力（ValueRow）と構造一致。 */
export type ValueRow = { grp: string; stationName: string; key: string; value: number }

export async function valuesForColumns(
  keys: string[],
  prefectures: string[],
): Promise<ValueRow[]> {
  // 全国は行数が max-rows(=1000) を超えるため、RPC は単一 jsonb で返す（配列を検証）。
  const raw = await rpc('values_for_columns', {
    column_keys: keys,
    prefs: prefectures.length > 0 ? prefectures : null, // 空は null＝全国
  })
  const rows = z.array(valueRowSchema).parse(raw)
  return rows.map((r) => ({ grp: r.grp, stationName: r.station_name, key: r.key, value: r.value }))
}

// --- 駅詳細 -------------------------------------------------------------
const bundleRowSchema = z.object({ key: z.string(), value: z.number() })

export async function stationBundle(grp: string): Promise<Map<string, number>> {
  const rows = await rpcRows('station_bundle', { in_grp: grp }, bundleRowSchema)
  return new Map(rows.map((r) => [r.key, r.value]))
}

const stationRowSchema = z.object({
  grp: z.string(),
  station_name: z.string(),
  label: z.string(),
  search_label: z.string(),
  prefecture: z.string(),
  lon: z.number(),
  lat: z.number(),
  n_op: z.number().nullable(),
  operators: z.string().nullable(),
  pax_latest: z.number().nullable(),
  lp_near_use: z.string().nullable(),
  level_complete: z.boolean().nullable(),
})

const STATION_COLUMNS =
  'grp,station_name,label,search_label,prefecture,lon,lat,n_op,operators,pax_latest,lp_near_use,level_complete'

export async function stationByGrp(grp: string): Promise<StationRow | null> {
  const { data, error } = await db()
    .from('stations')
    .select(STATION_COLUMNS)
    .eq('grp', grp)
    .maybeSingle()
  if (error) throw new DbError(error.message)
  if (data === null) return null
  const row = stationRowSchema.parse(data)
  return {
    grp: row.grp,
    stationName: row.station_name,
    label: row.label,
    searchLabel: row.search_label,
    prefecture: row.prefecture,
    lon: row.lon,
    lat: row.lat,
    nOp: row.n_op,
    operators: row.operators,
    paxLatest: row.pax_latest,
    lpNearUse: row.lp_near_use,
    levelComplete: row.level_complete,
  }
}

// --- 全駅 GeoJSON（RPC が単一 jsonb で返す・max-rows 回避） -------------
const geojsonSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.unknown()),
})
export type StationFeatureCollection = z.infer<typeof geojsonSchema>

export async function stationsGeojson(): Promise<StationFeatureCollection> {
  return geojsonSchema.parse(await rpc('stations_geojson', {}))
}

// --- ヘルス（cron 用・DB 1 クエリ） -------------------------------------
export async function healthCheck(): Promise<boolean> {
  const { error } = await db().from('metric_columns').select('id').limit(1)
  return error === null
}
