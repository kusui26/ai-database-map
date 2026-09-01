/**
 * RPC / select の型付きラッパ（DB 由来の snake_case を camelCase に整える）。
 * 結果は Zod で検証してから返す（DB 形状ドリフトの防御）。domain には依存しない（下位層）。
 */

import { z } from 'zod'
import { type StationListItem, type StationRow, type StationSummary } from '@/shared/api'
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
  municipality: z.string().nullable().optional(), // search_stations のみ返す（260902）
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
    ...(row.municipality === undefined ? {} : { municipality: row.municipality }),
    ...(row.dist_m === undefined ? {} : { distM: row.dist_m }),
  }
}

// --- 駅一覧（対象集合・260902 PR-4） ------------------------------------
const listRowSchema = z.object({
  grp: z.string(),
  station_name: z.string(),
  label: z.string(),
  prefecture: z.string(),
  municipality: z.string().nullable(),
  municipality_code: z.string().nullable(),
  lon: z.number(),
  lat: z.number(),
  n_op: z.number().nullable(),
  pax_latest: z.number().nullable(),
})

export type ListStationsFilter = {
  readonly prefectures?: readonly string[]
  /** 市区町村名（前方一致・例「横浜市」）または JIS コード（前方一致）。 */
  readonly municipality?: string
  /** 運営会社・路線・事業者種別（rank/scatter と同じ述語 station_matches_filters・260903）。 */
  readonly operators?: readonly string[]
  readonly routes?: readonly string[]
  readonly routeTypes?: readonly number[]
  /** 地図範囲（4 値すべて揃ったときだけ効く）。 */
  readonly bbox?: {
    readonly west: number
    readonly south: number
    readonly east: number
    readonly north: number
  }
  /** 中心と半径（m・geography の正確な距離で絞る）。 */
  readonly near?: { readonly lon: number; readonly lat: number; readonly radiusM: number }
  /** 明示の駅 ID 集合（build_dataset の grps 指定・260903）。 */
  readonly grps?: readonly string[]
  readonly limit?: number
}

/** 空配列は null（＝絞らない）へ写す（既存 RPC の空配列の扱いと揃える）。 */
function arrayOrNull<T>(values: readonly T[] | undefined): readonly T[] | null {
  return values !== undefined && values.length > 0 ? values : null
}

/** 対象集合を作る（値は返さない・`list_stations` RPC）。並びは乗降客数の降順。 */
export async function listStations(filter: ListStationsFilter): Promise<StationListItem[]> {
  const rows = await rpcRows(
    'list_stations',
    {
      prefs: arrayOrNull(filter.prefectures),
      muni: filter.municipality ?? null,
      ops: arrayOrNull(filter.operators),
      routes_in: arrayOrNull(filter.routes),
      route_types: arrayOrNull(filter.routeTypes),
      west: filter.bbox?.west ?? null,
      south: filter.bbox?.south ?? null,
      east: filter.bbox?.east ?? null,
      north: filter.bbox?.north ?? null,
      near_lon: filter.near?.lon ?? null,
      near_lat: filter.near?.lat ?? null,
      near_radius_m: filter.near?.radiusM ?? null,
      grps: arrayOrNull(filter.grps),
      lim: filter.limit ?? null,
    },
    listRowSchema,
  )
  return rows.map((row) => ({
    grp: row.grp,
    stationName: row.station_name,
    label: row.label,
    prefecture: row.prefecture,
    municipality: row.municipality,
    municipalityCode: row.municipality_code,
    lon: row.lon,
    lat: row.lat,
    nOp: row.n_op,
    paxLatest: row.pax_latest,
  }))
}

// --- データセット（駅×指標の一括値・260903 PR-5） -----------------------
const datasetValuesSchema = z.record(z.string(), z.record(z.string(), z.number()))

/**
 * 駅×指標の値を 1 回で取る（`dataset_rows` RPC・jsonb＝PostgREST の max-rows を跨がない）。
 * 返りは grp → { key → value }。値の無いセルはキー自体が無い（NaN 非格納の規約どおり）。
 */
export async function datasetRows(
  grps: readonly string[],
  keys: readonly string[],
): Promise<Record<string, Record<string, number>>> {
  if (grps.length === 0 || keys.length === 0) return {}
  return datasetValuesSchema.parse(await rpc('dataset_rows', { grps: [...grps], keys: [...keys] }))
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
  operators: readonly string[] = [],
  routes: readonly string[] = [],
  routeTypes: readonly number[] = [],
): Promise<{ rows: RankRow[]; total: number }> {
  const args = {
    column_key: columnKey,
    prefs: prefectures.length > 0 ? prefectures : null, // 空は null＝全国（PostgREST の空配列回避）
    dir: order,
    lim: limit,
    off: offset,
    exclude_lown: excludeLowN,
    // 絞り込みは散布（scatter_points）と同じ述語を DB 側で共有している（260801）。
    // ランキングは total とページングを SQL で数えるため、ここで渡さないと件数が狂う。
    ops: operators.length > 0 ? operators : null,
    routes: routes.length > 0 ? routes : null,
    route_types: routeTypes.length > 0 ? routeTypes : null,
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

// --- 散布（駅 1 行に畳んだ形・260804） ---------------------------------
/** buildGrowth の入力（ScatterRow）と構造一致。 */
export type ScatterRow = {
  grp: string
  stationName: string
  x: number
  y: number
  xFlag: number | null
  yFlag: number | null
}

const scatterRowSchema = z.object({
  grp: z.string(),
  station_name: z.string(),
  x: z.number(),
  y: z.number(),
  x_flag: z.number().nullable(),
  y_flag: z.number().nullable(),
})

/** 散布の絞り込み条件（DB 側で解決する。空＝絞らない）。 */
export type ScatterFilters = {
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
}

/**
 * 散布の点（駅ごとに x・y と、それぞれの信頼性フラグ）。
 *
 * 以前は縦持ち（1 駅 × キーごとに 1 行）を返し、アプリ側で pivot していた。grp と駅名が
 * 最大 4 回重複するため、アプリが検証する JSON が 3,256KB あった。SQL 側で畳むと 756KB
 * （転送は 336KB → 112KB・docs/260803_processing_speed.md §15.3）。
 * x か y が欠ける駅は DB で落とす（描けないため。従来のアプリ側の間引きと同じ結果）。
 */
export async function scatterPoints(
  xKey: string,
  yKey: string,
  xFlagKey: string | null,
  yFlagKey: string | null,
  filters: ScatterFilters,
): Promise<ScatterRow[]> {
  const raw = await rpc('scatter_points', {
    x_key: xKey,
    y_key: yKey,
    x_flag_key: xFlagKey,
    y_flag_key: yFlagKey,
    prefs: filters.prefectures.length > 0 ? [...filters.prefectures] : null,
    ops: filters.operators.length > 0 ? [...filters.operators] : null,
    routes: filters.routes.length > 0 ? [...filters.routes] : null,
    route_types: filters.routeTypes.length > 0 ? [...filters.routeTypes] : null,
  })
  const rows = z.array(scatterRowSchema).parse(raw)
  return rows.map((r) => ({
    grp: r.grp,
    stationName: r.station_name,
    x: r.x,
    y: r.y,
    xFlag: r.x_flag,
    yFlag: r.y_flag,
  }))
}

// --- 運営会社（散布の絞り込み用の一覧） ---------------------------------
const operatorRowSchema = z.object({
  name: z.string(),
  station_count: z.number(),
  prefectures: z.array(z.string()).nullable().default([]), // 走行する都道府県（260731）
})

/**
 * 運営会社の一覧（社名＋駅グループ数＋走行する都道府県・駅数の多い順）。
 * セレクタ・都道府県との連動・AI ツールが参照する。
 */
export async function operatorNames(): Promise<
  { name: string; stationCount: number; prefectures: string[] }[]
> {
  const rows = await rpcRows('operator_names', {}, operatorRowSchema)
  return rows.map((r) => ({
    name: r.name,
    stationCount: r.station_count,
    prefectures: r.prefectures ?? [],
  }))
}

// --- 路線（散布の絞り込み用の一覧・260731） -----------------------------
const routeRowSchema = z.object({
  route: z.string(),
  station_count: z.number(),
  operators: z.array(z.string()).nullable().default([]),
  route_types: z.array(z.number()).nullable().default([]),
})

/**
 * 路線の一覧（路線名＋駅グループ数＋運営会社＋事業者種別・駅数の多い順）。
 * 同名で会社が異なる路線があるため（「本線」は 10 社）、operators を併せて返す。
 */
export async function routeNames(): Promise<
  { route: string; stationCount: number; operators: string[]; routeTypes: number[] }[]
> {
  const rows = await rpcRows('route_names', {}, routeRowSchema)
  return rows.map((r) => ({
    route: r.route,
    stationCount: r.station_count,
    operators: r.operators ?? [],
    routeTypes: r.route_types ?? [],
  }))
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
  municipality: z.string().nullable(),
  lon: z.number(),
  lat: z.number(),
  n_op: z.number().nullable(),
  operators: z.string().nullable(),
  pax_latest: z.number().nullable(),
  lp_near_use: z.string().nullable(),
  level_complete: z.boolean().nullable(),
})

const STATION_COLUMNS =
  'grp,station_name,label,search_label,prefecture,municipality,lon,lat,n_op,operators,pax_latest,lp_near_use,level_complete'

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
    municipality: row.municipality,
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
