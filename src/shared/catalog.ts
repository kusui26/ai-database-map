/**
 * メトリクス・カタログのロード＋Zod 検証（単一の真実）。
 *
 * `catalog.json`（pipeline が生成）をロード時に Zod で検証し、型（`z.infer`）を導出する。
 * UI 選択肢・API 検証・AI ツール記述はすべてこの 1 ファイル経由でカタログを参照する。
 * 破損時はモジュール初期化で即失敗する（fail fast）。
 */

import { z } from 'zod'
import catalogJson from './catalog/catalog.json'
import { CATEGORIES, type Category } from './constants'

export const categorySchema = z.enum([
  'passenger',
  'population',
  'population_forecast',
  'land_price',
  'bus',
  'establishment',
  'employee',
])

export const kindSchema = z.enum(['level', 'growth', 'flag', 'error', 'ratio'])
export const unitSchema = z.enum(['人', '人/日', '円/㎡', '%', '箇所', '事業所', 'm']).nullable()
export const formatSchema = z.enum(['int', 'decimal1', 'percent1', 'ratio1', 'yen']).nullable()

export const catalogEntrySchema = z.object({
  key: z.string(),
  baseMetric: z.string(),
  kind: kindSchema,
  category: categorySchema,
  labelJa: z.string(),
  unit: unitSchema,
  format: formatSchema,
  radiusM: z.number().nullable(),
  year: z.number().nullable(),
  yearBase: z.number().nullable(),
  vintage: z.number().nullable(),
  reliabilityFlagKey: z.string().nullable(),
  rankable: z.boolean(),
  higherIsBetter: z.boolean().nullable(),
  source: z.string(),
  license: z.string(),
})
export type CatalogEntry = z.infer<typeof catalogEntrySchema>

export const stationAttributeSchema = z.object({
  key: z.string(),
  type: z.enum(['string', 'number', 'boolean']),
  labelJa: z.string(),
  role: z.string(),
})
export type StationAttribute = z.infer<typeof stationAttributeSchema>

export const catalogSchema = z.object({
  version: z.number(),
  generatedFrom: z.string(),
  columnCount: z.number(),
  stationAttributeCount: z.number(),
  entryCount: z.number(),
  radii: z.array(z.number()),
  categories: z.array(categorySchema),
  stationAttributes: z.array(stationAttributeSchema),
  entries: z.array(catalogEntrySchema),
})
export type Catalog = z.infer<typeof catalogSchema>

/** ロード時検証（破損なら throw）。 */
export const catalog: Catalog = catalogSchema.parse(catalogJson)

export const entries: readonly CatalogEntry[] = catalog.entries
export const stationAttributes: readonly StationAttribute[] = catalog.stationAttributes

const byKey = new Map<string, CatalogEntry>(entries.map((entry) => [entry.key, entry]))
const byCategory = new Map<Category, CatalogEntry[]>(
  CATEGORIES.map((category) => [category, entries.filter((entry) => entry.category === category)]),
)

/** key → エントリ（無ければ undefined）。 */
export function getEntry(key: string): CatalogEntry | undefined {
  return byKey.get(key)
}

/** key → エントリ（無ければ throw。API 検証済みの内部利用向け）。 */
export function requireEntry(key: string): CatalogEntry {
  const entry = byKey.get(key)
  if (entry === undefined) throw new Error(`未知のメトリクス key: ${key}`)
  return entry
}

/** カテゴリ内のエントリ（表示順＝CSV 列順）。 */
export function entriesForCategory(category: Category): readonly CatalogEntry[] {
  return byCategory.get(category) ?? []
}

/** ランキング/散布の候補（rankable=true）。 */
export const rankableEntries: readonly CatalogEntry[] = entries.filter((entry) => entry.rankable)

/** カテゴリ内の rankable エントリ。 */
export function rankableForCategory(category: Category): readonly CatalogEntry[] {
  return entriesForCategory(category).filter((entry) => entry.rankable)
}

/** key が実在するランキング可能な指標かを検証（API のホワイトリスト用）。 */
export function isRankableKey(key: string): boolean {
  return byKey.get(key)?.rankable === true
}
