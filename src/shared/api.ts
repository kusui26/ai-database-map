/**
 * 共通API の入出力契約（Zod・全エンドポイントが従う）。plan_fable §3.3。
 * UI と AI は同じ型（z.infer）を共有し、Route Handler は入力を検証し出力をこの形に整える。
 */

import { z } from 'zod'
import { categorySchema, formatSchema, kindSchema, unitSchema } from './catalog'
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
  clusterCount: z.number(),
  excludedLowN: z.number(),
  points: z.array(scatterPointSchema),
})
export type GrowthResponse = z.infer<typeof growthResponseSchema>

/** 運営会社の一覧（GET /api/operators）。散布の会社セレクタが参照する。 */
export const operatorSchema = z.object({
  name: z.string(),
  stationCount: z.number(),
})
export type Operator = z.infer<typeof operatorSchema>

export const operatorsResponseSchema = z.object({
  operators: z.array(operatorSchema), // 駅グループ数の多い順
})
export type OperatorsResponse = z.infer<typeof operatorsResponseSchema>

export const healthResponseSchema = z.object({ ok: z.literal(true) })
export type HealthResponse = z.infer<typeof healthResponseSchema>
