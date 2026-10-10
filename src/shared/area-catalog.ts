/**
 * 区域の指標のカタログ（`catalog/area-catalog.json` のロード＋Zod 検証・2026-10-10 B5b）。
 *
 * エリア（行政区域・沿線）全体の値の**意味の単一の定義**——名前・単位・年・作り方（公表値・推計の市区町村ごとの合計・
 * メッシュの按分）と出典。`pipeline/build_area_values.py` が `pipeline/area_rules.py` から生成する契約物で、
 * DB の `area_metrics.meta` はその写し（`docs/area_values.md` §2）。駅の指標のカタログ（`catalog.ts`）とは別に持つ——
 * 区域の値は半径を持たず、区域の種類ごとに作り方が違う。
 */

import { z } from 'zod'
import areaCatalogJson from './catalog/area-catalog.json'
import { categorySchema, formatSchema } from './catalog'

/** 区域の種類（DB の `areas.kind`）。 */
export const areaKindSchema = z.enum([
  'country',
  'prefecture',
  'city',
  'special_wards',
  'municipality',
  'ward',
  'line',
])
export type AreaKind = z.infer<typeof areaKindSchema>

/** 作り方：公表値・推計の市区町村ごとの合計・メッシュの面積按分。 */
export const areaMethodSchema = z.enum(['official', 'projection', 'mesh'])
export type AreaMethod = z.infer<typeof areaMethodSchema>

export const areaSourceSchema = z.object({
  method: areaMethodSchema,
  sourceJa: z.string(),
  license: z.string(),
})
export type AreaSource = z.infer<typeof areaSourceSchema>

export const areaMetricSchema = z.object({
  key: z.string(),
  baseMetric: z.enum(['pop', 'pop_pred', 'estab_n', 'emp_n']),
  category: categorySchema,
  labelJa: z.string(),
  unit: z.string(),
  format: formatSchema,
  year: z.number().int(),
  vintage: z.number().int().nullable(),
  sources: z.object({ admin: areaSourceSchema, line: areaSourceSchema.nullable() }),
})
export type AreaMetric = z.infer<typeof areaMetricSchema>

export const areaCatalogSchema = z.object({
  version: z.number(),
  generatedFrom: z.string(),
  kinds: z.array(z.object({ kind: areaKindSchema, labelJa: z.string() })),
  lineWidthsM: z.array(z.number().int()),
  years: z.object({
    population: z.array(z.number().int()),
    populationLine: z.array(z.number().int()),
    projection: z.array(z.number().int()),
    economy: z.array(z.number().int()),
  }),
  metrics: z.array(areaMetricSchema),
})
export type AreaCatalog = z.infer<typeof areaCatalogSchema>

/** ロード時検証（破損なら throw）。 */
export const areaCatalog: AreaCatalog = areaCatalogSchema.parse(areaCatalogJson)

const byKey = new Map<string, AreaMetric>(areaCatalog.metrics.map((metric) => [metric.key, metric]))
const kindLabels = new Map<AreaKind, string>(
  areaCatalog.kinds.map((kind) => [kind.kind, kind.labelJa]),
)

/** key → 区域の指標（無ければ undefined）。 */
export function getAreaMetric(key: string): AreaMetric | undefined {
  return byKey.get(key)
}

/** 区域の種類の名前（「政令市（市全体）」「沿線」）。 */
export function areaKindLabel(kind: AreaKind): string {
  return kindLabels.get(kind) ?? kind
}

/** ある系統（`pop`・`pop_pred`…）の指標を年の古い順に。 */
export function areaMetricsOf(baseMetric: AreaMetric['baseMetric']): readonly AreaMetric[] {
  return areaCatalog.metrics
    .filter((metric) => metric.baseMetric === baseMetric)
    .sort((a, b) => a.year - b.year)
}
