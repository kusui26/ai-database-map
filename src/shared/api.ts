/**
 * 共通API の入出力契約（Zod・全エンドポイントが従う）。plan_fable §3.3。
 * UI と AI は同じ型（z.infer）を共有し、Route Handler は入力を検証し出力をこの形に整える。
 */

import { z } from 'zod'
import { categorySchema, formatSchema, kindSchema, unitSchema } from './catalog'
import { hazardGroupSchema, hazardLayerSchema, hazardLevelSchema } from './hazard'
import { rankingRowSchema, scatterPointSchema } from './protocol'

// --- エラー封筒 ---------------------------------------------------------
export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

export const orderSchema = z.enum(['asc', 'desc'])
export type Order = z.infer<typeof orderSchema>

// --- クエリ入力（?query= から。数値は coerce） --------------------------
export const metricsQuerySchema = z.object({ category: categorySchema.optional() })

export const stationsQuerySchema = z.object({
  q: z.string().min(1).optional(),
  bbox: z.string().optional(), // "west,south,east,north"
  near: z.string().optional(), // "lon,lat"
})

const boolFlag = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1')

export const rankingQuerySchema = z.object({
  metric: z.string(),
  prefectures: z.array(z.string()).default([]), // 空＝全国（P6c）
  operators: z.array(z.string()).default([]), // 空＝全社（260801・散布と同じ意味）
  routes: z.array(z.string()).default([]), // 空＝全路線（260801）
  routeTypes: z.array(z.number().int()).default([]), // 空＝全種別（routes とは OR）
  order: orderSchema.default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(50), // P6c: ページサイズ
  offset: z.coerce.number().int().min(0).default(0), // P6c: ページング
  excludeLowN: boolFlag, // P6c: ⚠ 除外
})

export const growthQuerySchema = z.object({
  x: z.string(),
  y: z.string(),
  prefectures: z.array(z.string()).default([]), // 空＝全国（P6c）
  operators: z.array(z.string()).default([]), // 空＝全社（260730・「・」分割の完全一致 OR）
  routes: z.array(z.string()).default([]), // 空＝全路線（260731）
  routeTypes: z.array(z.number().int()).default([]), // 空＝全種別（1:新幹線 …・routes とは OR）
  excludeLowN: boolFlag,
})

// --- 駅（DB 行 → プレゼンタ入力・要約） ---------------------------------
export const stationRowSchema = z.object({
  grp: z.string(),
  stationName: z.string(),
  label: z.string(),
  searchLabel: z.string(),
  prefecture: z.string(),
  lon: z.number(),
  lat: z.number(),
  nOp: z.number().nullable(),
  operators: z.string().nullable(), // 運営会社名（pax規模降順・「・」連結・P5d で追加）
  paxLatest: z.number().nullable(),
  lpNearUse: z.string().nullable(),
  levelComplete: z.boolean().nullable(),
})
export type StationRow = z.infer<typeof stationRowSchema>

export const stationSummarySchema = z.object({
  grp: z.string(),
  stationName: z.string(),
  label: z.string(),
  searchLabel: z.string().optional(), // 検索表示用（label＋都道府県・一意。search_stations のみ）
  prefecture: z.string(),
  lon: z.number(),
  lat: z.number(),
  paxLatest: z.number().nullable(),
  distM: z.number().optional(), // near 検索のみ
})
export type StationSummary = z.infer<typeof stationSummarySchema>

// --- 駅詳細（presenter が組み立てる：カテゴリ×半径の系列） --------------
export const detailPointSchema = z.object({
  key: z.string(), // カタログ列 key（点を一意に addressable に：AI が特定点を参照可能）
  year: z.number().nullable(),
  yearBase: z.number().nullable(),
  value: z.number().nullable(),
  formatted: z.string(),
  flagged: z.boolean(),
})
export type DetailPoint = z.infer<typeof detailPointSchema>

export const metricSeriesSchema = z.object({
  baseMetric: z.string(),
  category: categorySchema,
  kind: kindSchema,
  labelJa: z.string(),
  unit: unitSchema,
  format: formatSchema,
  radiusM: z.number().nullable(),
  vintage: z.number().nullable(),
  points: z.array(detailPointSchema),
})
export type MetricSeries = z.infer<typeof metricSeriesSchema>

export const stationDetailSchema = z.object({
  station: stationRowSchema,
  series: z.array(metricSeriesSchema),
})
export type StationDetail = z.infer<typeof stationDetailSchema>

// --- ランキング / 散布のレスポンス --------------------------------------
export const metricRefSchema = z.object({
  key: z.string(),
  labelJa: z.string(),
  unit: unitSchema,
})
export type MetricRef = z.infer<typeof metricRefSchema>

export const rankingResponseSchema = z.object({
  metric: metricRefSchema,
  prefectures: z.array(z.string()), // 空＝全国（P6c）
  operators: z.array(z.string()).default([]), // 空＝全社（260801）
  routes: z.array(z.string()).default([]), // 空＝全路線（260801）
  routeTypes: z.array(z.number()).default([]), // 空＝全種別（260801）
  order: orderSchema,
  offset: z.number(), // このページの先頭順位-1（P6c）
  total: z.number(), // フィルタ後の総件数（P6c）
  rows: z.array(rankingRowSchema),
})
export type RankingResponse = z.infer<typeof rankingResponseSchema>

export const growthResponseSchema = z.object({
  x: metricRefSchema,
  y: metricRefSchema,
  prefectures: z.array(z.string()), // 空＝全国（P6c）
  operators: z.array(z.string()).default([]), // 空＝全社（260730）
  routes: z.array(z.string()).default([]), // 空＝全路線（260731）
  routeTypes: z.array(z.number()).default([]), // 空＝全種別（260731）
  clusterCount: z.number(),
  excludedLowN: z.number(),
  points: z.array(scatterPointSchema),
})
export type GrowthResponse = z.infer<typeof growthResponseSchema>

/** 運営会社の一覧（GET /api/operators）。散布の会社セレクタが参照する。 */
export const operatorSchema = z.object({
  name: z.string(),
  stationCount: z.number(),
  /**
   * その会社が走行する都道府県（260731・都道府県セレクタとの連動に使う）。
   * 1 日キャッシュの古い応答には無いことがあるため optional＋既定 `[]`（連動が無効になるだけ）。
   */
  prefectures: z.array(z.string()).default([]),
})
export type Operator = z.infer<typeof operatorSchema>

export const operatorsResponseSchema = z.object({
  operators: z.array(operatorSchema), // 駅グループ数の多い順
})
export type OperatorsResponse = z.infer<typeof operatorsResponseSchema>

/** 路線の一覧（GET /api/routes）。散布の路線セレクタが参照する（260731）。 */
export const routeSchema = z.object({
  route: z.string(),
  stationCount: z.number(),
  /** その路線を運営する会社（同名で会社が異なる路線があるため配列・例「本線」は 10 社）。 */
  operators: z.array(z.string()).default([]),
  /** 事業者種別（1:JR新幹線 2:JR在来線 3:公営 4:民営 5:第三セクター）。同名で異なる場合がある。 */
  routeTypes: z.array(z.number()).default([]),
})
export type Route = z.infer<typeof routeSchema>

export const routesResponseSchema = z.object({
  routes: z.array(routeSchema), // 駅グループ数の多い順
})
export type RoutesResponse = z.infer<typeof routesResponseSchema>

// --- ハザード・レイヤカタログ（GET /api/hazard/catalog・260824_flood §6） ---

export const hazardCatalogQuerySchema = z.object({ group: hazardGroupSchema.optional() })

/** レイヤ制御の見出し 1 つ（グループ）。レイヤが 0 件のグループは返さない。 */
export const hazardGroupRefSchema = z.object({
  group: hazardGroupSchema,
  labelJa: z.string(),
  layerKeys: z.array(z.string()),
})
export type HazardGroupRef = z.infer<typeof hazardGroupRefSchema>

/** 危険度レベルの自己記述（消費側が constants を知らなくても描ける）。 */
export const hazardLevelRefSchema = z.object({
  level: hazardLevelSchema,
  labelJa: z.string(),
  color: z.string(),
})
export type HazardLevelRef = z.infer<typeof hazardLevelRefSchema>

/**
 * ハザード・カタログの応答。**自己記述的**にするため、レイヤ本体だけでなく
 * グループ・危険度のラベルと色も返す（LLM がそのまま説明に使える・architecture.md §6）。
 */
export const hazardCatalogResponseSchema = z.object({
  version: z.number(),
  groups: z.array(hazardGroupRefSchema),
  levels: z.array(hazardLevelRefSchema),
  /** 全応答に添える免責（UI も AI もこの 1 文を使う）。 */
  disclaimerJa: z.string(),
  layers: z.array(hazardLayerSchema),
})
export type HazardCatalogResponse = z.infer<typeof hazardCatalogResponseSchema>

export const healthResponseSchema = z.object({ ok: z.literal(true) })
export type HealthResponse = z.infer<typeof healthResponseSchema>
