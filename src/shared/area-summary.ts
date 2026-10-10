/**
 * エリア要約と駅の色分けの**応答の形**（共通 API `GET /api/areas`・`/api/areas/summary`・`/api/stations/classes`・
 * 2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12）。
 *
 * 値・言い方・分け方はすべてドメイン（`src/domain/area-summary/`・`src/domain/style/`）が決め、画面と AI は同じものを読む。
 *
 * - **区域の値**（`totals`）はエリア全体の値。市区町村・都道府県は公表値、沿線はメッシュの按分、駅から N m は駅の円の値。
 *   **駅の値を足したものではない**（駅の円は重なる）。作り方は値ごとに名乗る（`method`）
 * - **駅の分布**（`stations`）はエリアの駅ごとの円の値の中央値・四分位・上位と下位で、エリア全体の値ではない
 * - 色分けの凡例（`legend`）の色と段はサーバが決める（画面・地図レポート・AI が同じ凡例を描く・説明する）
 */

import { z } from 'zod'
import { formatSchema } from './catalog'
import { areaKindSchema, areaMetricSchema } from './area-catalog'

// --- 色分け -------------------------------------------------------------------------

/** 分け方：水準は 5 分位（sequential）、増減・誤差は 0 を中心に 5 段（diverging）。 */
export const classSchemeSchema = z.enum(['sequential', 'diverging'])
export type ClassScheme = z.infer<typeof classSchemeSchema>

/** 色分けの 1 段。範囲は下限を含み上限を含まない（端の段は片側が null）。 */
export const stationClassSchema = z.object({
  index: z.number().int().min(0),
  color: z.string(),
  lower: z.number().nullable(),
  upper: z.number().nullable(),
  /** 「25,000 人未満」「−5〜−1%」「+5% 以上」。 */
  labelJa: z.string(),
  count: z.number().int().min(0),
})
export type StationClass = z.infer<typeof stationClassSchema>

export const stationLegendSchema = z.object({
  metricKey: z.string(),
  /** 指標の名前（年・半径つき・カタログの名前）。 */
  titleJa: z.string(),
  unit: z.string().nullable(),
  scheme: classSchemeSchema,
  classes: z.array(stationClassSchema),
  /** ⚠（母数が小さいなど）の駅：分け方に入れず、この色の「参考値」で出す。 */
  flagged: z.object({ color: z.string(), labelJa: z.string(), count: z.number().int().min(0) }),
  /** エリアの駅のうち、この指標の値が無い駅（描かない）。 */
  missingCount: z.number().int().min(0),
  /** 色の意味（「赤は増加、青は減少、灰色はほぼ横ばい（-1〜+1%）。0 が真ん中。」）。AI はこの文で説明する。色分けしなければ null。 */
  meaningJa: z.string().nullable(),
  sourceJa: z.string(),
  /** 色分けしなかった理由（値のある駅が 5 未満・値が 1 種類・段に分けられない）。色分けしたら null。 */
  reasonJa: z.string().nullable(),
})
export type StationLegend = z.infer<typeof stationLegendSchema>

/**
 * 駅 1 つの段（`legend.classes` の index）。null は、色分けしたときは ⚠ の参考値（`legend.flagged.color` で描く）、
 * 色分けしなかったとき（`legend.reasonJa` がある）はすべての駅（色を付けず、強調で出す）。
 */
export const stationClassAssignmentSchema = z.object({
  grp: z.string(),
  cls: z.number().int().nullable(),
})

export const stationClassesResponseSchema = z.object({
  /** 色分けしたエリア（エリアの文字列・指定の順）。2 つ以上は合わせて 1 つの凡例。 */
  areas: z.array(z.string()),
  legend: stationLegendSchema,
  /** 値のある駅（値の無い駅は入らない・描かない）。 */
  stations: z.array(stationClassAssignmentSchema),
})
export type StationClassesResponse = z.infer<typeof stationClassesResponseSchema>

/** 地図の色分けの条件（地図の操作 `colorStations` と同じもの・B5c）。 */
export const stationColoringSchema = z.object({
  metricKey: z.string(),
  areas: z.array(z.string()),
})
export type StationColoring = z.infer<typeof stationColoringSchema>

// --- エリアの一覧（GET /api/areas） ------------------------------------------------------

/** 無い値とその理由（`areas.missing`）。 */
export const areaMissingSchema = z.object({ keys: z.array(z.string()), reasonJa: z.string() })
export type AreaMissing = z.infer<typeof areaMissingSchema>

export const areaCatalogEntrySchema = z.object({
  ref: z.string(),
  kind: areaKindSchema,
  code: z.string().nullable(),
  /** 駅の市区町村と同じ言い方（政令市の区は「横浜市港北区」）。 */
  nameJa: z.string(),
  /** 都道府県つきの言い方（「神奈川県横浜市港北区」）。 */
  labelJa: z.string(),
  prefecture: z.string().nullable(),
  /** 内訳の親（区 → 政令市、市区町村・政令市 → 都道府県、都道府県 → 全国）。 */
  parentRef: z.string().nullable(),
  /** 束ねる集まり（東京の 23 の区 → muni:13100）。 */
  groupRef: z.string().nullable(),
  stationCount: z.number().int().min(0),
  missing: z.array(areaMissingSchema),
})
export type AreaCatalogEntry = z.infer<typeof areaCatalogEntrySchema>

export const areasResponseSchema = z.object({
  kinds: z.array(z.object({ kind: areaKindSchema, labelJa: z.string() })),
  /** 行政区域（全国・都道府県・政令市・東京 23 区・市区町村・区）。沿線は `/api/lines` の路線コードと幅で書く。 */
  areas: z.array(areaCatalogEntrySchema),
  lineWidthsM: z.array(z.number().int()),
  /** エリアの文字列の書き方。 */
  refFormatsJa: z.array(z.string()),
  /** 区域の指標（名前・単位・年・区域の種類ごとの作り方と出典）。 */
  metrics: z.array(areaMetricSchema),
})
export type AreasResponse = z.infer<typeof areasResponseSchema>

// --- エリア要約（GET /api/areas/summary） ---------------------------------------------------

/** 要約のエリアの種類（行政区域・沿線に、駅から N m・範囲を足したもの）。 */
export const areaSummaryKindSchema = z.enum([...areaKindSchema.options, 'near', 'bbox'])
export type AreaSummaryKind = z.infer<typeof areaSummaryKindSchema>

/** 区域の値の作り方（駅から N m は、起点の駅の円の値＝メッシュの按分）。 */
export const areaTotalMethodSchema = z.enum(['official', 'projection', 'mesh', 'stationRadius'])
export type AreaTotalMethod = z.infer<typeof areaTotalMethodSchema>

export const areaTotalIdSchema = z.enum([
  'population',
  'populationFuture',
  'establishments',
  'employees',
])
export type AreaTotalId = z.infer<typeof areaTotalIdSchema>

export const areaPointSchema = z.object({
  year: z.number().int(),
  value: z.number(),
  kind: z.enum(['actual', 'projection']),
})
export type AreaPoint = z.infer<typeof areaPointSchema>

/** 2 つの年のあいだの増減。 */
export const areaChangeSchema = z.object({
  fromYear: z.number().int(),
  toYear: z.number().int(),
  /** 増減率（%）。 */
  rate: z.number(),
  /** 「-0.7%」「+4.9%」。 */
  rateJa: z.string(),
  /** 「2020→2025年で -0.7%」。 */
  textJa: z.string(),
})
export type AreaChange = z.infer<typeof areaChangeSchema>

/** 年と値（と書いた形）。 */
export const areaYearValueSchema = z.object({
  year: z.number().int(),
  value: z.number(),
  valueJa: z.string(),
})
export type AreaYearValue = z.infer<typeof areaYearValueSchema>

/** 推計の当たり具合（2025 年の実績と、2020 年起点の推計の 2025 年）。 */
export const areaAccuracySchema = z.object({
  year: z.number().int(),
  projected: z.number(),
  actual: z.number(),
  /** 実績 ÷ 推計 − 1（%）。負＝推計が多すぎた。 */
  gapRate: z.number(),
  /** 「2025年の実績は推計より 0.9% 少ない」。 */
  textJa: z.string(),
})
export type AreaAccuracy = z.infer<typeof areaAccuracySchema>

/** 区域の値 1 系統（人口・将来推計人口・事業所・従業者）。 */
export const areaTotalSchema = z.object({
  id: areaTotalIdSchema,
  /** 「人口」「将来推計人口」「事業所（民営）」「従業者（民営）」。 */
  labelJa: z.string(),
  unit: z.string(),
  method: areaTotalMethodSchema,
  /** 「公表値」「推計（市区町村ごとの合計）」「メッシュの按分」「駅の円の値」。 */
  methodJa: z.string(),
  sourceJa: z.string(),
  points: z.array(areaPointSchema),
  /** 先に言う値（人口・事業所・従業者は最新の年、将来推計人口は 2050 年）。 */
  lead: areaYearValueSchema,
  changes: z.array(areaChangeSchema),
  /** 推計の山（将来推計人口だけ・いちばん多い年が途中にあるとき。ずっと減る・ずっと増えるなら null）。 */
  peak: areaYearValueSchema.nullable(),
  /** 推計の当たり具合（将来推計人口・2025 年の実績がある区域だけ）。 */
  accuracy: areaAccuracySchema.nullable(),
  /** 1 行の要約（「3,750,952 人（2025年）・2020→2025年で -0.7%」）。 */
  headlineJa: z.string(),
})
export type AreaTotal = z.infer<typeof areaTotalSchema>

/** 駅 1 つの値（分布の上位・下位）。 */
export const areaStationValueSchema = z.object({
  grp: z.string(),
  labelJa: z.string(),
  value: z.number(),
  valueJa: z.string(),
})
export type AreaStationValue = z.infer<typeof areaStationValueSchema>

/** エリアの駅の、ある指標の分布（⚠ の値は除いて数える）。 */
export const areaStationStatSchema = z.object({
  key: z.string(),
  /** 短い名前（「人口」「人口の増減」）。 */
  labelJa: z.string(),
  /** いつの値か（「2020年」「2015→2020年」「2020→2050年・R6推計」）。 */
  periodJa: z.string(),
  radiusM: z.number().nullable(),
  unit: z.string().nullable(),
  format: formatSchema,
  /** 値のある駅（⚠ を除く）。 */
  n: z.number().int().min(0),
  flaggedN: z.number().int().min(0),
  missingN: z.number().int().min(0),
  median: z.number().nullable(),
  q1: z.number().nullable(),
  q3: z.number().nullable(),
  medianJa: z.string(),
  /** 「+0.2%〜+4.9%」（四分位）。 */
  rangeJa: z.string(),
  top: z.array(areaStationValueSchema),
  bottom: z.array(areaStationValueSchema),
  /** この指標だけの注意（半径を替えた）。無ければ null。 */
  noteJa: z.string().nullable(),
})
export type AreaStationStat = z.infer<typeof areaStationStatSchema>

export const areaStationsSchema = z.object({
  /** エリアの駅の数。 */
  count: z.number().int().min(0),
  /** 駅の周りを集計した半径（m）。 */
  radiusM: z.number(),
  stats: z.array(areaStationStatSchema),
})
export type AreaStations = z.infer<typeof areaStationsSchema>

/** 内訳の 1 行（区・市区町村・都道府県、沿線なら駅）。 */
export const areaBreakdownRowSchema = z.object({
  /** 子の区域（エリアの文字列）。沿線の駅は null。 */
  ref: z.string().nullable(),
  /** 沿線の駅（grp）。区域なら null。 */
  grp: z.string().nullable(),
  nameJa: z.string(),
  value: z.number().nullable(),
  valueJa: z.string(),
  change: z.number().nullable(),
  changeJa: z.string(),
  future: z.number().nullable(),
  futureJa: z.string(),
  stationCount: z.number().int().nullable(),
})
export type AreaBreakdownRow = z.infer<typeof areaBreakdownRowSchema>

export const areaBreakdownSchema = z.object({
  /** 「区」「市区町村」「都道府県」「駅（路線の順）」。 */
  byJa: z.string(),
  valueLabelJa: z.string(),
  changeLabelJa: z.string(),
  futureLabelJa: z.string(),
  /** 並び：区域は増減の大きい順、沿線は路線の駅の順。 */
  rows: z.array(areaBreakdownRowSchema),
  noteJa: z.string().nullable(),
})
export type AreaBreakdown = z.infer<typeof areaBreakdownSchema>

export const areaSummarySchema = z.object({
  /** エリアの文字列（正規の形）。 */
  ref: z.string(),
  kind: areaSummaryKindSchema,
  /** 「政令市（市全体）」「沿線」「駅から 5km の円」「地図の範囲」。 */
  kindJa: z.string(),
  nameJa: z.string(),
  labelJa: z.string(),
  parent: z.object({ ref: z.string(), nameJa: z.string() }).nullable(),
  areaKm2: z.number().nullable(),
  stationCount: z.number().int().min(0),
  totals: z.array(areaTotalSchema),
  /** 無い値とその理由（区域の値が無い種類のエリア・浜松の区の再編・浜通りの推計…）。 */
  unavailableJa: z.array(z.string()),
  stations: areaStationsSchema,
  breakdown: areaBreakdownSchema.nullable(),
})
export type AreaSummary = z.infer<typeof areaSummarySchema>

/** 比べる表の 1 行（エリアごとの書いた値）。 */
export const areaComparisonRowSchema = z.object({
  labelJa: z.string(),
  cells: z.array(z.string()),
})

/** 指数（基準年＝100）の系列（大きさの違うエリアの伸び方を重ねる）。 */
export const areaIndexSeriesSchema = z.object({
  ref: z.string(),
  nameJa: z.string(),
  points: z.array(areaPointSchema),
})

export const areaComparisonSchema = z.object({
  refs: z.array(z.string()),
  names: z.array(z.string()),
  rows: z.array(areaComparisonRowSchema),
  baseYear: z.number().int(),
  index: z.array(areaIndexSeriesSchema),
  notesJa: z.array(z.string()),
})
export type AreaComparison = z.infer<typeof areaComparisonSchema>

export const areaSourceRefSchema = z.object({ source: z.string(), license: z.string() })

export const areaSummaryResponseSchema = z.object({
  areas: z.array(areaSummarySchema).min(1),
  /** 2 つ以上のエリアのとき。 */
  comparison: areaComparisonSchema.nullable(),
  /** 地図の色分けの条件（`colorBy=none`・色分けしなかった〔`legend.reasonJa`〕なら null）。 */
  coloring: stationColoringSchema.nullable(),
  /** 色分けの凡例（`colorBy=none` なら null。色分けしなかったときも理由を載せて返す）。 */
  legend: stationLegendSchema.nullable(),
  /** 駅の周りを集計した半径（m）。 */
  radiusM: z.number(),
  notesJa: z.array(z.string()),
  /** このデータが見ていないこと（増えた理由・地価や所得のエリア全体の値…）。 */
  notIncludedJa: z.array(z.string()),
  sources: z.array(areaSourceRefSchema),
})
export type AreaSummaryResponse = z.infer<typeof areaSummaryResponseSchema>

// --- パネル（GUI Chat Protocol の `areaSummary`・B5b） -----------------------------------------

/** パネルに載せる区域の値（年ごとの値は推移の図〔`trendChart`〕に回すので持たない）。 */
export const areaTotalLineSchema = areaTotalSchema.omit({ points: true })
export type AreaTotalLine = z.infer<typeof areaTotalLineSchema>

/** パネルに載せるエリア 1 つ（年ごとの値と内訳の行は図〔`trendChart`・`barChart`〕に回す）。 */
export const areaSummaryCardSchema = areaSummarySchema
  .omit({ totals: true, breakdown: true })
  .extend({ totals: z.array(areaTotalLineSchema) })
export type AreaSummaryCard = z.infer<typeof areaSummaryCardSchema>

/** パネルに載せる比べる表（指数の系列は推移の図に回す）。 */
export const areaComparisonTableSchema = areaComparisonSchema.omit({ index: true })
export type AreaComparisonTable = z.infer<typeof areaComparisonTableSchema>
