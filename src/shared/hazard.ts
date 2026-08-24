/**
 * ハザード・レイヤカタログのロード＋Zod 検証（単一の真実）。
 *
 * `hazard/hazard-catalog.json`（`pipeline/build_hazard_catalog.py` が生成）をロード時に
 * Zod で検証し、型（`z.infer`）を導出する。**凡例 UI・API 検証・AI ツール記述はすべて
 * この 1 ファイル経由**でカタログを参照する。フロントに凡例テキストや色を直書きした瞬間、
 * 「UI では説明されるが AI は知らない」というズレが生まれる（.claude/CLAUDE.md §2）。
 * 破損時はモジュール初期化で即失敗する（fail fast・catalog.ts と同じ流儀）。
 *
 * 設計の正は `docs/260824_flood.md` §5.4。
 */

import { z } from 'zod'
import catalogJson from './hazard/hazard-catalog.json'
import { HAZARD_GROUPS, HAZARD_LEVELS, type HazardGroup, type HazardLevel } from './constants'

// --- スキーマ -------------------------------------------------------------

/** ハザードグループ（`constants.HAZARD_GROUPS` と一致・不変条件はテストが守る）。 */
export const hazardGroupSchema = z.enum([
  'flood',
  'inland_flood',
  'storm_surge',
  'tsunami',
  'landslide',
  'terrain',
  'realtime',
])

/** 危険度レベル（軽い順・`constants.HAZARD_LEVELS` と一致）。 */
export const hazardLevelSchema = z.enum(['none', 'caution', 'warning', 'danger', 'critical'])

/**
 * 配色の根拠。
 * - `official` … 出典の凡例仕様（国交省マニュアル）の RGB。配信タイルの実測とも一致を確認済み
 * - `measured` … 公式仕様を確認できず、配信タイルの実測で得た色（階級との対応に推定を含む）
 * - `null`     … 色を確定していない（実測標本に出現しなかった階級）
 *
 * 凡例 UI は `measured` に控えめな注記を出し、`null` は色見本を出さない。
 * 「どこまで確かか」を型に残すのは `reliabilityFlagKey` / `noticeFlagKey` と同じ思想。
 */
export const colorSourceSchema = z.enum(['official', 'measured']).nullable()

/**
 * 避難行動（`docs/260824_flood.md` §6.2 の判定結果）。
 * `constants.EVACUATION_LABELS_JA` と 1 対 1（不変条件はテストが守る）。
 */
export const evacuationActionSchema = z.enum(['takeaway', 'vertical', 'stay'])

/** 階級の単位（量でない区分は null）。 */
export const rankUnitSchema = z.enum(['m', 'hour']).nullable()

/** タイル配信の形式。 */
export const tileFormatSchema = z.enum(['png', 'geojson', 'pbf'])

/** 更新頻度（`static`＝更新なし／`annual`＝年 1 回／`10min`＝10 分毎）。 */
export const updateCadenceSchema = z.enum(['static', 'annual', '10min'])

/** 凡例の 1 階級。色・意味・行動がここに揃う（UI も AI も同じ文字列を読む）。 */
export const hazardRankSchema = z.object({
  /** 凡例の並び（1 が最も軽い）。タイルの配色 1 つに対応する。 */
  order: z.number().int().positive(),
  labelJa: z.string(),
  /** その階級が何を意味するか（例「2 階部分が浸水する高さ」）。 */
  meaningJa: z.string(),
  /** どうすべきかの目安（断定しない文言・docs/260824_flood.md §6.2・§7.5）。 */
  actionJa: z.string().nullable(),
  level: hazardLevelSchema,
  /** `#RRGGBB`（大文字・未確定は null）。 */
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/)
    .nullable(),
  colorSource: colorSourceSchema,
  /** 階級の下限（単位は layer.rankUnit）。 */
  min: z.number().nullable(),
  /** 階級の上限（開区間は null）。 */
  max: z.number().nullable(),
  /** 国土数値情報のコード値（詳細版で細分された階級は、包含する原典コード）。 */
  sourceCode: z.number().int().nullable(),
})
export type HazardRank = z.infer<typeof hazardRankSchema>

/** XYZ タイル配信の定義。 */
export const hazardTileSchema = z.object({
  url: z.string(),
  minZoom: z.number().int(),
  maxZoom: z.number().int(),
  format: tileFormatSchema,
})
export type HazardTile = z.infer<typeof hazardTileSchema>

/** 自前 250m メッシュの配布（Phase 1b で `available` が true になる）。 */
export const hazardMeshSchema = z.object({
  available: z.boolean(),
  pathTemplate: z.string(),
})
export type HazardMesh = z.infer<typeof hazardMeshSchema>

export const hazardLayerSchema = z.object({
  key: z.string(),
  group: hazardGroupSchema,
  labelJa: z.string(),
  /** 1〜2 文の説明。AI がそのまま回答に使える粒度で書く。 */
  summaryJa: z.string(),
  rankUnit: rankUnitSchema,
  ranks: z.array(hazardRankSchema),
  tile: hazardTileSchema.nullable(),
  mesh: hazardMeshSchema.nullable(),
  /** 公式凡例・データ詳細のページ（階級を自前で持たないレイヤの逃げ道）。 */
  legendUrl: z.string().nullable(),
  vintage: z.number().int().nullable(),
  updateCadence: updateCadenceSchema,
  source: z.string(),
  license: z.string(),
  /** 地図に常時表示する出典（レイヤを足すと自動で増える）。 */
  attribution: z.string(),
  /** 網羅性の注記。**「白＝安全」と読ませない**ための本体（同 §7.5-2）。 */
  coverageNoteJa: z.string().nullable(),
  /** 網羅性が低いレイヤで空白を埋める参考レイヤ（内水 → 地形・同 §3.7）。 */
  fallbackLayersJa: z.array(z.string()),
})
export type HazardLayer = z.infer<typeof hazardLayerSchema>

export const hazardCatalogSchema = z.object({
  version: z.number().int(),
  generatedFrom: z.string(),
  layerCount: z.number().int(),
  groups: z.array(hazardGroupSchema),
  levels: z.array(hazardLevelSchema),
  /** 全応答に添える免責（UI も AI もこの 1 文を使う）。 */
  disclaimerJa: z.string(),
  layers: z.array(hazardLayerSchema),
})
export type HazardCatalog = z.infer<typeof hazardCatalogSchema>

// --- ロード（破損なら throw） --------------------------------------------

export const hazardCatalog: HazardCatalog = hazardCatalogSchema.parse(catalogJson)

export const hazardLayers: readonly HazardLayer[] = hazardCatalog.layers

/** 全応答に添える免責（`docs/260824_flood.md` §7.5-5）。 */
export const HAZARD_DISCLAIMER_JA = hazardCatalog.disclaimerJa

const byKey = new Map<string, HazardLayer>(hazardLayers.map((layer) => [layer.key, layer]))
const byGroup = new Map<HazardGroup, HazardLayer[]>(
  HAZARD_GROUPS.map((group) => [group, hazardLayers.filter((layer) => layer.group === group)]),
)

// --- 参照（catalog.ts と同じ語彙） ---------------------------------------

/** key → レイヤ（無ければ undefined）。 */
export function getHazardLayer(key: string): HazardLayer | undefined {
  return byKey.get(key)
}

/** key → レイヤ（無ければ throw。API 検証済みの内部利用向け）。 */
export function requireHazardLayer(key: string): HazardLayer {
  const layer = byKey.get(key)
  if (layer === undefined) throw new Error(`未知のハザードレイヤ key: ${key}`)
  return layer
}

/** グループ内のレイヤ（表示順＝カタログ順）。 */
export function hazardLayersForGroup(group: HazardGroup): readonly HazardLayer[] {
  return byGroup.get(group) ?? []
}

/** key が実在するレイヤかを検証する（API のホワイトリスト用・型ガード）。 */
export function isHazardLayerKey(key: string): boolean {
  return byKey.has(key)
}

/** 値が危険度レベルか（外部入力の検証用・型ガード）。 */
export function isHazardLevel(value: unknown): value is HazardLevel {
  return typeof value === 'string' && HAZARD_LEVELS.some((level) => level === value)
}

/** レイヤ内の階級を `order` で引く（無ければ undefined）。 */
export function rankOf(layer: HazardLayer, order: number): HazardRank | undefined {
  return layer.ranks.find((rank) => rank.order === order)
}
