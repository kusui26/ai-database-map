/**
 * GUI Chat Protocol (Map Edition) v1 — 構造化UI（クリック）と LLM（会話）が
 * produce/consume する共通の応答型（architecture.md §4・plan_fable §3.2）。
 *
 * P5/P6 の UI パネルはこの Panel 型を props に取り、Step2 でそのままレンダラになる。
 * すべて Zod で定義し、型は z.infer で導出する（UI と AI が同一の型を共有）。
 */

import { z } from 'zod'
import { categorySchema } from './catalog'

// --- メッセージ ---------------------------------------------------------
export const messageSchema = z.object({
  role: z.enum(['assistant', 'user']),
  text: z.string(),
})
export type Message = z.infer<typeof messageSchema>

// --- 地図アクション（返答ストリーミング中に即時実行） -------------------
export const mapActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('flyTo'),
    lon: z.number(),
    lat: z.number(),
    zoom: z.number().optional(),
  }),
  z.object({ type: z.literal('selectStation'), grp: z.string(), radiusM: z.number().optional() }),
  z.object({ type: z.literal('highlightStations'), grps: z.array(z.string()) }),
  z.object({ type: z.literal('clearOverlays') }),
])
export type MapAction = z.infer<typeof mapActionSchema>

// --- パネル部品 ---------------------------------------------------------
/** 表示先ヒント（チャット=inline 既定・⤢で drawer/modal へ昇格）。 */
export const placementSchema = z.enum(['inline', 'drawer', 'modal']).optional()
/** 表示バリアント（チャット内=compact／ドロワー・モーダル=full）。 */
export const sizeSchema = z.enum(['compact', 'full']).optional()

/** 信頼性フラグの注意表示（lowbase/lown）。 */
export const reliabilityFlagSchema = z.object({
  label: z.string(),
  level: z.enum(['warn', 'info']),
})
export type ReliabilityFlag = z.infer<typeof reliabilityFlagSchema>

/** 時系列の 1 点（y は欠損で null＝チャートのギャップ）。 */
export const seriesPointSchema = z.object({ x: z.number(), y: z.number().nullable() })

/** トレンドチャートの 1 系列（実線/破線・色はカテゴリ駆動）。 */
export const trendSeriesSchema = z.object({
  label: z.string(),
  points: z.array(seriesPointSchema),
  color: z.string().optional(),
  dashed: z.boolean().optional(),
})
export type TrendSeries = z.infer<typeof trendSeriesSchema>

export const rankingRowSchema = z.object({
  rank: z.number(),
  grp: z.string(),
  name: z.string(),
  prefecture: z.string(),
  value: z.number(),
  formatted: z.string(),
  flagged: z.boolean(),
})
export type RankingRow = z.infer<typeof rankingRowSchema>

export const scatterPointSchema = z.object({
  grp: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  cluster: z.number(),
})
export type ScatterPoint = z.infer<typeof scatterPointSchema>

export const panelSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stationCard'),
    grp: z.string(),
    stationName: z.string(),
    label: z.string(),
    prefecture: z.string(),
    operators: z.string().nullable(),
    paxLatest: z.number().nullable(),
    badges: z.array(reliabilityFlagSchema),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('trendChart'),
    title: z.string(),
    unit: z.string().nullable(),
    category: categorySchema.optional(),
    flags: z.array(reliabilityFlagSchema),
    series: z.array(trendSeriesSchema),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('rankingTable'),
    title: z.string(),
    metricKey: z.string(),
    unit: z.string().nullable(),
    rows: z.array(rankingRowSchema),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('scatter'),
    title: z.string(),
    xLabel: z.string(),
    yLabel: z.string(),
    xUnit: z.string().nullable(),
    yUnit: z.string().nullable(),
    points: z.array(scatterPointSchema),
    clusterCount: z.number(),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('markdown'),
    body: z.string(),
    placement: placementSchema,
    size: sizeSchema,
  }),
])
export type Panel = z.infer<typeof panelSchema>

// --- 応答本体 -----------------------------------------------------------
export const mapResponseSchema = z.object({
  messages: z.array(messageSchema),
  mapActions: z.array(mapActionSchema),
  panels: z.array(panelSchema),
})
export type MapResponse = z.infer<typeof mapResponseSchema>
