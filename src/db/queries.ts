/**
 * RPC / select の型付きラッパ（DB 由来の snake_case を camelCase に整える）。
 * 結果は Zod で検証してから返す（DB 形状ドリフトの防御）。domain には依存しない（下位層）。
 */

import { z } from 'zod'
import {
  type LineRef,
  type StationListItem,
  type StationRow,
  type StationSummary,
} from '@/shared/api'
import { areaKindSchema, type AreaKind } from '@/shared/area-catalog'
import { areaMissingSchema, type AreaMissing } from '@/shared/area-summary'
import { stationHazardSummarySchema, type StationHazardSummary } from '@/shared/hazard-summary'
import { type Viewport } from '@/shared/viewport'
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

// --- 駅の絞り込み（一覧・ランキング・散布で同じ・SQL の stations_matching_filters） ----------

/** 起点と半径（m・楕円体の上の距離で絞る・起点からの距離も返る）。 */
export type NearPoint = { readonly lon: number; readonly lat: number; readonly radiusM: number }

/**
 * 駅の絞り込み（未指定・空＝絞らない・条件どうしは AND）。一覧・ランキング・散布が同じ形で受け、
 * DB の絞り込み（`stations_matching_filters`・条件に合う駅の集合・単一の定義）が同じ意味で絞る（2026-10-08 B2 で市区町村・
 * 範囲・近傍を足し、2026-10-10 に駅ごとの真偽の述語から駅の集合に作り直した——会社・路線などで絞っても速い）。
 */
export type StationFilter = {
  readonly prefectures?: readonly string[]
  /** 市区町村名（前方一致・例「横浜市」で全区）または JIS コード（前方一致）。 */
  readonly municipality?: string
  /** 運営会社（S12 の会社名・どれか）。 */
  readonly operators?: readonly string[]
  /** 法令上の路線（S12）・事業者種別（この 2 つは OR）。 */
  readonly routes?: readonly string[]
  readonly routeTypes?: readonly number[]
  /** 路線（運行系統）の路線コード。どれかの路線の駅（261008 L2）。 */
  readonly lines?: readonly number[]
  /** 地図の範囲（経度・緯度）。 */
  readonly bbox?: Viewport
  /** 起点から半径 m 以内。 */
  readonly near?: NearPoint
}

/** 駅の一覧の条件（絞り込み＋明示の駅・件数）。 */
export type ListStationsFilter = StationFilter & {
  /** 明示の駅 ID 集合（build_dataset の grps 指定・260903）。 */
  readonly grps?: readonly string[]
  readonly limit?: number
}

/** 空配列は null（＝絞らない）へ写す（既存 RPC の空配列の扱いと揃える）。 */
function arrayOrNull<T>(values: readonly T[] | undefined): readonly T[] | null {
  return values !== undefined && values.length > 0 ? values : null
}

/**
 * 絞り込み → RPC の引数（法令上の路線を除く。名前が RPC ごとに違う：rank/scatter は `routes`、一覧は `routes_in`）。
 * 3 つの RPC が同じ組み立てを使うので、条件を足すときはここだけ直せばよい。
 */
function filterArgs(filter: StationFilter): Record<string, unknown> {
  return {
    prefs: arrayOrNull(filter.prefectures),
    muni: filter.municipality ?? null,
    ops: arrayOrNull(filter.operators),
    route_types: arrayOrNull(filter.routeTypes),
    line_cds: arrayOrNull(filter.lines),
    west: filter.bbox?.west ?? null,
    south: filter.bbox?.south ?? null,
    east: filter.bbox?.east ?? null,
    north: filter.bbox?.north ?? null,
    near_lon: filter.near?.lon ?? null,
    near_lat: filter.near?.lat ?? null,
    near_radius_m: filter.near?.radiusM ?? null,
  }
}

/** 起点からの距離（m）を整数に（近傍でなければ undefined＝返却に載せない）。 */
function distanceOf(distM: number | null | undefined): { readonly distM?: number } {
  return distM === null || distM === undefined ? {} : { distM: Math.round(distM) }
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
  dist_m: z.number().nullable().optional(), // 起点からの距離（近傍のときだけ・261008 B2）
})

/**
 * 対象集合を作る（値は返さない・`list_stations` RPC）。並びは乗降客数の降順。
 *
 * ⚠ **1 回の応答は 1,000 行で打ち切られる**（PostgREST の行上限。SQL 側の `lim` は 2,000 まで
 * 受けるが、それより先に PostgREST が切る・2026-09-16 実測）。`limit` に 1,000 超を渡しても
 * **1,000 件しか返らず、切られたことは応答から分からない**——多く来る条件で使うときは、
 * 呼び出し側で「1,000 に達したか」を見るか、上限を 1,000 未満に置いて超過を検出する
 * （`src/domain/recommend/request.ts` の `MAX_CANDIDATE_STATIONS` はそうしている）。
 */
export async function listStations(filter: ListStationsFilter): Promise<StationListItem[]> {
  const rows = await rpcRows(
    'list_stations',
    {
      ...filterArgs(filter),
      routes_in: arrayOrNull(filter.routes),
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
    ...distanceOf(row.dist_m),
  }))
}

// --- 全駅の索引（AI の入口で起点の駅名・市区町村名を解決する・261008 B2） -------
const catalogStationSchema = z.object({
  grp: z.string(),
  name: z.string(),
  label: z.string(),
  prefecture: z.string(),
  municipality: z.string().nullable(),
  municipality_code: z.string().nullable(),
  lon: z.number(),
  lat: z.number(),
  pax: z.number().nullable(),
})

/** 全駅の索引の 1 駅。 */
export type CatalogStation = {
  readonly grp: string
  readonly name: string
  /** 表示名（同じ名前の駅は「大塚（東日本旅客鉄道）」）。 */
  readonly label: string
  readonly prefecture: string
  readonly municipality: string | null
  readonly municipalityCode: string | null
  readonly lon: number
  readonly lat: number
  readonly paxLatest: number | null
}

/** 全駅の索引（`station_catalog`・jsonb 1 つ＝1,000 行の上限を超えて全駅）。 */
export async function stationCatalog(): Promise<CatalogStation[]> {
  const rows = z.array(catalogStationSchema).parse(await rpc('station_catalog', {}))
  return rows.map((row) => ({
    grp: row.grp,
    name: row.name,
    label: row.label,
    prefecture: row.prefecture,
    municipality: row.municipality,
    municipalityCode: row.municipality_code,
    lon: row.lon,
    lat: row.lat,
    paxLatest: row.pax,
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

// --- 駅別ハザードサマリ（事前計算・260903 PR-6） -------------------------
const hazardSummaryRowSchema = z.object({
  grp: z.string(),
  version: z.number(),
  computed_at: z.string(),
  summary: z.unknown(),
})

export type StationHazardRow = {
  readonly grp: string
  readonly version: number
  readonly computedAt: string
  readonly summary: StationHazardSummary
}

/** RPC 側の 1 回あたり上限（migration の limit と同値）。 */
const HAZARD_SUMMARY_CHUNK = 500

/**
 * 駅別ハザードサマリを取る（`station_hazard_summaries` RPC）。
 * RPC は 500 件ずつなので、build_dataset（≤2000 駅）向けにここで分割して合流する。
 * summary は Zod（shared/hazard-summary）で検証してから返す（DB 形状ドリフトの防御）。
 */
export async function stationHazardSummaries(grps: readonly string[]): Promise<StationHazardRow[]> {
  const out: StationHazardRow[] = []
  for (let index = 0; index < grps.length; index += HAZARD_SUMMARY_CHUNK) {
    const rows = await rpcRows(
      'station_hazard_summaries',
      { grps: grps.slice(index, index + HAZARD_SUMMARY_CHUNK) },
      hazardSummaryRowSchema,
    )
    for (const row of rows) {
      out.push({
        grp: row.grp,
        version: row.version,
        computedAt: row.computed_at,
        summary: stationHazardSummarySchema.parse(row.summary),
      })
    }
  }
  return out
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
  dist_m: z.number().nullable().optional(), // 起点からの距離（近傍のときだけ・261008 B2）
})

/** buildRanking の入力（RankRawRow）と構造一致。 */
export type RankRow = {
  grp: string
  stationName: string
  prefecture: string
  value: number
  flagValue: number | null
  rank: number
  /** 起点からの距離（m・整数）。近傍で絞ったときだけ。 */
  distM?: number
}

/** ランキングの 1 ページの取り方。 */
export type RankPage = {
  readonly order: 'asc' | 'desc'
  readonly limit: number
  readonly offset: number
  /** 信頼性の低い値（⚠）の駅を除く。 */
  readonly excludeLowN: boolean
}

/**
 * rank_by_column の 1 ページ（rows＋絞り込み後の総件数）。絞り込みは散布・一覧と同じ述語を DB 側で共有している
 * （ランキングは total とページングを SQL で数えるので、絞り込みを SQL に渡さないと件数が狂う）。
 */
export async function rankByColumn(
  columnKey: string,
  filter: StationFilter,
  page: RankPage,
): Promise<{ rows: RankRow[]; total: number }> {
  const args = {
    column_key: columnKey,
    dir: page.order,
    lim: page.limit,
    off: page.offset,
    exclude_lown: page.excludeLowN,
    ...filterArgs(filter),
    routes: arrayOrNull(filter.routes),
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
      ...distanceOf(r.dist_m),
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
  filter: StationFilter,
): Promise<ScatterRow[]> {
  const raw = await rpc('scatter_points', {
    x_key: xKey,
    y_key: yKey,
    x_flag_key: xFlagKey,
    y_flag_key: yFlagKey,
    ...filterArgs(filter),
    routes: arrayOrNull(filter.routes),
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

/** 運営会社の一覧の 1 行（S12 の会社名・駅グループ数・走行する都道府県）。 */
export type OperatorRow = {
  readonly name: string
  readonly stationCount: number
  readonly prefectures: readonly string[]
}

/**
 * 運営会社の一覧（社名＋駅グループ数＋走行する都道府県・駅数の多い順）。
 * セレクタ・都道府県との連動・AI ツールが参照する。社名は S12 の会社名（表示名は `domain/operators.ts`）。
 */
export async function operatorNames(): Promise<OperatorRow[]> {
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

// --- 路線（運行系統・駅データ.jp・261008 L2） -----------------------------
const lineRowSchema = z.object({
  line_cd: z.number(),
  name: z.string(),
  formal_name: z.string(),
  company_name: z.string(),
  company_short: z.string(),
  operator: z.string().nullable(),
  color: z.string().nullable(),
  color_name: z.string().nullable(),
  line_type: z.number(),
  is_loop: z.boolean(),
  station_count: z.number(),
  prefectures: z.array(z.string()).nullable().default([]),
  source: z.string(),
})

/** 路線の一覧の 1 行（DB の形を camelCase にしたもの・表示名は付けない＝下位層）。 */
export type LineRow = {
  readonly lineCd: number
  readonly name: string
  readonly formalName: string
  readonly companyName: string
  readonly companyShort: string
  readonly operator: string | null
  readonly color: string | null
  readonly colorName: string | null
  readonly lineType: number
  readonly isLoop: boolean
  readonly stationCount: number
  readonly prefectures: readonly string[]
  readonly source: string
}

/** 路線の一覧（`line_names` RPC・路線コードの順。601 行なので PostgREST の行上限に届かない）。 */
export async function lineNames(): Promise<LineRow[]> {
  const rows = await rpcRows('line_names', {}, lineRowSchema)
  return rows.map((r) => ({
    lineCd: r.line_cd,
    name: r.name,
    formalName: r.formal_name,
    companyName: r.company_name,
    companyShort: r.company_short,
    operator: r.operator,
    color: r.color,
    colorName: r.color_name,
    lineType: r.line_type,
    isLoop: r.is_loop,
    stationCount: r.station_count,
    prefectures: r.prefectures ?? [],
    source: r.source,
  }))
}

const lineRefRowSchema = z.object({ line_cd: z.number(), name: z.string() })

/**
 * 路線コード → 名前（主キーで引くだけ・知らないコードは返らない）。
 * 応答に「どの路線で絞ったか」を名前で返すため・知らないコードを 400 にするために使う。
 */
export async function linesByCodes(codes: readonly number[]): Promise<LineRef[]> {
  if (codes.length === 0) return []
  const { data, error } = await db()
    .from('lines')
    .select('line_cd,name')
    .in('line_cd', [...codes])
  if (error) throw new DbError(error.message)
  return z
    .array(lineRefRowSchema)
    .parse(data)
    .map((r) => ({ lineCd: r.line_cd, name: r.name }))
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

// --- 駅周辺のプロフィールの順位（県内・市内・261009 B4） --------------------
const profileRankRowSchema = z.object({
  key: z.string(),
  value: z.number(),
  pref_rank: z.number(),
  pref_total: z.number(),
  area_rank: z.number().nullable(),
  area_total: z.number().nullable(),
})

/** 指標 1 つの順位（値の大きい順・同じ値は同じ順位・total は値のある駅の数）。市内は駅がその中にあるときだけ。 */
export type ProfileRankRow = {
  readonly key: string
  readonly prefRank: number
  readonly prefTotal: number
  readonly areaRank: number | null
  readonly areaTotal: number | null
}

/**
 * 駅の指標が県内（と市内）で何位か（`station_profile_ranks` RPC・1 駅 11 指標で約 50ms）。
 * 値の無い指標・知らない key は返らない（Map に無い＝位置なし）。`area` は市区町村の前方一致（政令市は「横浜市」で全区）。
 */
export async function stationProfileRanks(
  grp: string,
  keys: readonly string[],
  area: string | null,
): Promise<Map<string, ProfileRankRow>> {
  if (keys.length === 0) return new Map()
  const rows = await rpcRows(
    'station_profile_ranks',
    { in_grp: grp, keys: [...keys], area },
    profileRankRowSchema,
  )
  return new Map(
    rows.map((row) => [
      row.key,
      {
        key: row.key,
        prefRank: row.pref_rank,
        prefTotal: row.pref_total,
        areaRank: row.area_rank,
        areaTotal: row.area_total,
      },
    ]),
  )
}

// --- エリアの区域の値（行政区域・沿線・261010 B5b） ------------------------------
const areaRowSchema = z.object({
  key: z.string(),
  kind: areaKindSchema,
  code: z.string().nullable(),
  line_cd: z.number().nullable(),
  width_m: z.number().nullable(),
  name: z.string(),
  label: z.string(),
  prefecture: z.string().nullable(),
  parent_key: z.string().nullable(),
  group_key: z.string().nullable(),
  area_km2: z.number(),
  missing: z.array(areaMissingSchema),
  station_count: z.number(),
  values: z.record(z.string(), z.number()),
})

/** 区域の 1 行（行政区域・沿線）と、その区域の値（区域の指標の key → 値）。 */
export type AreaRow = {
  readonly key: string
  readonly kind: AreaKind
  readonly code: string | null
  readonly lineCd: number | null
  readonly widthM: number | null
  /** 駅の市区町村と同じ言い方（政令市の区は「横浜市港北区」）・沿線は路線の名前。 */
  readonly nameJa: string
  /** 題に使う言い方（「神奈川県横浜市」「東急東横線の沿線（駅から 1km）」）。 */
  readonly labelJa: string
  readonly prefecture: string | null
  readonly parentKey: string | null
  readonly groupKey: string | null
  readonly areaKm2: number
  readonly missing: readonly AreaMissing[]
  /** 区域の駅の数（政令市＝区の駅・東京 23 区＝23 の区の駅・沿線＝路線の駅）。 */
  readonly stationCount: number
  readonly values: ReadonlyMap<string, number>
}

/**
 * 区域の行と値（`area_rows` RPC・jsonb 1 つ）。`withChildren` なら内訳の子（政令市 → 区・都道府県 → 市区町村・
 * 全国 → 都道府県・東京 23 区 → 23 の区）も返す。知らない鍵は返らない（呼び出し側が 400 にする）。
 */
export async function areaRows(keys: readonly string[], withChildren: boolean): Promise<AreaRow[]> {
  if (keys.length === 0) return []
  const rows = z
    .array(areaRowSchema)
    .parse(await rpc('area_rows', { keys: [...keys], with_children: withChildren }))
  return rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    code: row.code,
    lineCd: row.line_cd,
    widthM: row.width_m,
    nameJa: row.name,
    labelJa: row.label,
    prefecture: row.prefecture,
    parentKey: row.parent_key,
    groupKey: row.group_key,
    areaKm2: row.area_km2,
    missing: row.missing,
    stationCount: row.station_count,
    values: new Map(Object.entries(row.values)),
  }))
}

const areaCatalogRowSchema = areaRowSchema.omit({
  line_cd: true,
  width_m: true,
  area_km2: true,
  values: true,
})

/** 行政区域の一覧の 1 行（値は持たない）。 */
export type AreaCatalogRow = Omit<AreaRow, 'lineCd' | 'widthM' | 'areaKm2' | 'values'>

/** 行政区域の一覧（`area_catalog` RPC・1,961 行は PostgREST の 1,000 行の上限を超えるので jsonb 1 つ）。 */
export async function areaCatalogRows(): Promise<AreaCatalogRow[]> {
  const rows = z.array(areaCatalogRowSchema).parse(await rpc('area_catalog', {}))
  return rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    code: row.code,
    nameJa: row.name,
    labelJa: row.label,
    prefecture: row.prefecture,
    parentKey: row.parent_key,
    groupKey: row.group_key,
    missing: row.missing,
    stationCount: row.station_count,
  }))
}

const stationValueRowSchema = z.object({ grp: z.string(), label: z.string(), value: z.number() })
const stationStatRowSchema = z.object({
  key: z.string(),
  n: z.number(),
  flagged_n: z.number(),
  q1: z.number().nullable(),
  median: z.number().nullable(),
  q3: z.number().nullable(),
  top: z.array(stationValueRowSchema),
  bottom: z.array(stationValueRowSchema),
})
const stationStatsSchema = z.object({
  station_count: z.number(),
  stats: z.array(stationStatRowSchema),
})

/** 分布の上位・下位の駅 1 つ。 */
export type StationValueRow = {
  readonly grp: string
  readonly label: string
  readonly value: number
}

/** エリアの駅の、ある指標の分布（⚠ の値は除いて数える）。 */
export type StationStatRow = {
  readonly key: string
  readonly n: number
  readonly flaggedN: number
  readonly q1: number | null
  readonly median: number | null
  readonly q3: number | null
  readonly top: readonly StationValueRow[]
  readonly bottom: readonly StationValueRow[]
}

/**
 * 分位の有効桁。`percentile_cont` は double で補間するので、2.3 と 2.4 の真ん中が 2.3499999999999996 になる
 * （小数 1 桁に書くと 2.3 に落ちる）。値は real（有効約 7 桁）から作るので、有効 12 桁で丸めても情報は落ちない。
 */
const PERCENTILE_DIGITS = 12

function percentileOf(value: number | null): number | null {
  return value === null ? null : Number(value.toPrecision(PERCENTILE_DIGITS))
}

/**
 * エリアの駅の値の分布（`area_station_stats` RPC）：駅の数と、指標ごとの値のある駅の数・⚠ の数・四分位・上位と下位の 3 駅。
 * 絞り込みは一覧・ランキングと同じ述語。知らない key は返らない。
 */
export async function areaStationStats(
  keys: readonly string[],
  filter: StationFilter,
): Promise<{ readonly stationCount: number; readonly stats: readonly StationStatRow[] }> {
  const raw = stationStatsSchema.parse(
    await rpc('area_station_stats', {
      keys: [...keys],
      ...filterArgs(filter),
      routes: arrayOrNull(filter.routes),
    }),
  )
  return {
    stationCount: raw.station_count,
    stats: raw.stats.map((row) => ({
      key: row.key,
      n: row.n,
      flaggedN: row.flagged_n,
      q1: percentileOf(row.q1),
      median: percentileOf(row.median),
      q3: percentileOf(row.q3),
      top: row.top,
      bottom: row.bottom,
    })),
  }
}

const metricValuesSchema = z.object({
  station_count: z.number(),
  values: z.array(z.tuple([z.string(), z.number().nullable(), z.number()])),
})

/** 駅 1 つの値（色分けの入力）。値の無い駅は null。 */
export type StationMetricValue = {
  readonly grp: string
  readonly value: number | null
  /** ⚠（指標の信頼性フラグが 1・値があるときだけ）。 */
  readonly flagged: boolean
}

/**
 * エリアの駅の値（`station_metric_values` RPC・jsonb 1 つ＝全国 9,273 駅でも 1 回で）。**値の無い駅も null で返る**——
 * 2 つのエリアを合わせて色分けするとき、駅の集合の和で「値なし」を二重に数えないため。
 */
export async function stationMetricValues(
  key: string,
  filter: StationFilter,
): Promise<{ readonly stationCount: number; readonly values: readonly StationMetricValue[] }> {
  const raw = metricValuesSchema.parse(
    await rpc('station_metric_values', {
      column_key: key,
      ...filterArgs(filter),
      routes: arrayOrNull(filter.routes),
    }),
  )
  return {
    stationCount: raw.station_count,
    values: raw.values.map(([grp, value, flag]) => ({ grp, value, flagged: flag === 1 })),
  }
}

const lineStationRowSchema = z.object({
  seq: z.number(),
  stations: z.object({ grp: z.string(), label: z.string() }),
})

/** 路線の駅（路線の中の並び）。 */
export type LineStation = { readonly seq: number; readonly grp: string; readonly label: string }

/** 路線の駅を路線の順に（`line_stations` と `stations` を外部キーで結ぶ・1 路線は多くて百数十駅）。 */
export async function lineStationsInOrder(lineCd: number): Promise<LineStation[]> {
  const { data, error } = await db()
    .from('line_stations')
    .select('seq,stations(grp,label)')
    .eq('line_cd', lineCd)
    .order('seq')
  if (error) throw new DbError(error.message)
  return z
    .array(lineStationRowSchema)
    .parse(data)
    .map((row) => ({ seq: row.seq, grp: row.stations.grp, label: row.stations.label }))
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
