/**
 * 共通API の入出力契約（Zod・全エンドポイントが従う）。plan_fable §3.3。
 * UI と AI は同じ型（z.infer）を共有し、Route Handler は入力を検証し出力をこの形に整える。
 */

import { z } from 'zod'
import { categorySchema, formatSchema, kindSchema, unitSchema } from './catalog'
import {
  evacuationActionSchema,
  hazardCertaintySchema,
  hazardGroupSchema,
  hazardLayerSchema,
  hazardLevelSchema,
} from './hazard'
import { jmaWarningKindSchema } from './jma'
import { ALERT_LEVELS } from './constants'
import { hazardItemSchema, rankingRowSchema, scatterPointSchema, sourceRefSchema } from './protocol'
import { evacuationDisasterKeySchema } from './evacuation'

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
  // 対象集合づくり（260902 PR-4）。municipality は前方一致（「横浜市」で全区を束ねる）。
  municipality: z.string().min(1).optional(),
  prefecture: z.string().min(1).optional(), // municipality と併用可（単独でも一覧になる）
  limit: z.coerce.number().int().min(1).max(2000).optional(),
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
  municipality: z.string().nullable(), // 市区町村（サイドカー・260902 PR-4。dataset.md §2.1 補）
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
  municipality: z.string().nullable().optional(), // search_stations / list_stations のみ（260902）
  lon: z.number(),
  lat: z.number(),
  paxLatest: z.number().nullable(),
  distM: z.number().optional(), // near 検索のみ
})
export type StationSummary = z.infer<typeof stationSummarySchema>

/**
 * 駅一覧（対象集合を作る・値は返さない・`docs/260828_research_claude_auth.md` §5.3）。
 * 「横浜市で」は municipality の前方一致で区を束ねる（RPC `list_stations`）。
 */
export const stationListItemSchema = z.object({
  grp: z.string(),
  stationName: z.string(),
  label: z.string(),
  prefecture: z.string(),
  municipality: z.string().nullable(),
  municipalityCode: z.string().nullable(),
  lon: z.number(),
  lat: z.number(),
  nOp: z.number().nullable(),
  paxLatest: z.number().nullable(),
})
export type StationListItem = z.infer<typeof stationListItemSchema>

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

// --- ハザード：地点（GET /api/hazard/point・260824_flood §6.1） ------------

/**
 * クエリ文字列の数値。**欠落と空文字を 0 にしない。**
 *
 * `z.coerce.number()` は `Number(null)` も `Number('')` も **0** にするので、
 * `?lat=35.7`（lon 欠落）が**経度 0 度**として通ってしまう。地点のハザードでは、
 * これは「500 で落ちる」で済まず、**別の場所について自信満々に『指定区域に入っていません』と
 * 答える**という最悪の壊れ方になりうる（§7.5）。だから欠落として扱い、400 で弾く。
 */
function queryNumber(min: number, max: number) {
  return z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number({ error: '数値が必要です（未指定・空文字は不可）' }).min(min).max(max),
  )
}

/** 緯度経度は必須。名前は「現在地」「亀有駅」など、呼び名を UI から渡せるようにする。 */
export const hazardPointQuerySchema = z.object({
  lon: queryNumber(-180, 180),
  lat: queryNumber(-90, 90),
  placeJa: z.string().min(1).max(60).optional(),
})
export type HazardPointQuery = z.infer<typeof hazardPointQuerySchema>

/** 浸水ナビ（想定最大規模）の 1 河川。「どの川が・何 m・何分後に・何日続く」がここに揃う。 */
export const hazardRiverSchema = z.object({
  nameJa: z.string(),
  /** 最大浸水深（m）。 */
  maxDepthM: z.number().nullable(),
  /** 最速到達時間（分）。 */
  arriveMin: z.number().nullable(),
  /** 最大継続時間（分）。 */
  continueMin: z.number().nullable(),
})
export type HazardRiver = z.infer<typeof hazardRiverSchema>

/**
 * その点は区域外だが、**近くが区域**のときの手掛かり（§8.3・§6.2 の追記）。
 *
 * 出所で意味が違うので、必ず一緒に運ぶ。
 * - `mesh` … **隣の 250m メッシュ**が区域（混在セルと GPS 誤差を補う）
 * - `tile` … **約 20m 以内**が区域（区域の縁。土砂のようにメッシュを持たない災害で効く）
 */
export const hazardNeighbourSchema = z.object({
  layerKey: z.string(),
  labelJa: z.string(),
  level: hazardLevelSchema,
  source: z.enum(['tile', 'mesh']),
  /** 「約 20m 以内」など、距離感の言い方（UI と AI で割らないようサーバが作る）。 */
  proximityJa: z.string(),
})
export type HazardNeighbour = z.infer<typeof hazardNeighbourSchema>

/** 総合判定（**必ずサーバが決める**。ここをフロントに書くと AI が同じ判断をできなくなる）。 */
export const hazardVerdictSchema = z.object({
  level: hazardLevelSchema,
  headlineJa: z.string(),
  /** 立退き／垂直避難／その場に留まる。**情報が足りないときは null**（断定しない）。 */
  evacuation: evacuationActionSchema.nullable(),
  reasonsJa: z.array(z.string()),
})
export type HazardVerdict = z.infer<typeof hazardVerdictSchema>

/**
 * 地点のハザード（意味づけ済み）。UI も AI もこの 1 つの形を読む。
 * **生の画素値・生のコード値は返さない**（architecture.md §6）。
 */
export const hazardPointResponseSchema = z.object({
  point: z.object({ lon: z.number(), lat: z.number(), placeJa: z.string() }),
  /** その地点を含む 250m メッシュ（コード・1 辺・中心）。 */
  mesh: z.object({
    code: z.string(),
    sizeM: z.number().int(),
    center: z.object({ lon: z.number(), lat: z.number() }),
  }),
  /** 平均標高（m）。配布しているのは平均のみで、無い区画は null。 */
  terrain: z.object({ elevMeanM: z.number().nullable() }),
  hazards: z.array(hazardItemSchema),
  neighbours: z.array(hazardNeighbourSchema),
  rivers: z.array(hazardRiverSchema),
  verdict: hazardVerdictSchema,
  /** 応答全体の確からしさ＝`hazards` のうち最も弱いもの。 */
  certainty: hazardCertaintySchema,
  /** 網羅性の注記（「白＝安全」と読ませない・§7.5-2）。 */
  coverageNotesJa: z.array(z.string()),
  sources: z.array(sourceRefSchema),
  /** 取得できなかったものの説明。**部分応答であることを隠さない**（§6.3）。 */
  notesJa: z.array(z.string()),
  disclaimerJa: z.string(),
})
export type HazardPointResponse = z.infer<typeof hazardPointResponseSchema>

// --- ハザード：アラート（GET /api/hazard/alerts・260824_flood §3.3(d)・§8.4） ------

/** 地点は必須。呼び名は UI から渡せる（「現在地」「亀有駅」）。 */
export const hazardAlertQuerySchema = z.object({
  lon: queryNumber(-180, 180),
  lat: queryNumber(-90, 90),
  placeJa: z.string().min(1).max(60).optional(),
})
export type HazardAlertQuery = z.infer<typeof hazardAlertQuerySchema>

/** 警戒レベル**相当**（0＝発表なし）。市町村が出す「警戒レベル◯」そのものではない。 */
export const alertLevelSchema = z.literal([...ALERT_LEVELS])

/** 気象庁が発表している 1 件（意味づけ済み）。 */
export const hazardAlertWarningSchema = z.object({
  code: z.string(),
  nameJa: z.string(),
  /** 未知のコードは種別も分からない（`null`）。**黙って落とさない**。 */
  kindJa: jmaWarningKindSchema.nullable(),
  alertLevel: alertLevelSchema,
  /** どの二次細分区域の発表か（市が複数区域に分かれるとき効く）。 */
  areaJa: z.string(),
  statusJa: z.string(),
  /** 気象庁が添えている補足（例「２７日８時から１３時まで、警戒レベル４相当」）。 */
  detailJa: z.string().nullable(),
})
export type HazardAlertWarning = z.infer<typeof hazardAlertWarningSchema>

/** 指定河川洪水予報の 1 件（氾濫注意〜氾濫発生）。 */
export const hazardFloodForecastSchema = z.object({
  riverNameJa: z.string(),
  nameJa: z.string(),
  alertLevel: alertLevelSchema,
  reportedAt: z.string().nullable(),
})
export type HazardFloodForecast = z.infer<typeof hazardFloodForecastSchema>

/** 地点が属する気象庁の区域。 */
export const hazardAlertAreaSchema = z.object({
  municipalityCode: z.string(),
  municipalityJa: z.string(),
  prefectureJa: z.string(),
  areas: z.array(z.object({ code: z.string(), nameJa: z.string() })),
})
export type HazardAlertArea = z.infer<typeof hazardAlertAreaSchema>

/**
 * 「いま、その地点はどうなっているか」。**平時の「もし起きたら」（`/api/hazard/point`）とは別物**で、
 * 混ぜて表示しない（§7.4 は 2 段に分けている）。
 */
export const hazardAlertsResponseSchema = z.object({
  point: z.object({ lon: z.number(), lat: z.number(), placeJa: z.string() }),
  /** 海上・国外など、市区町村が決まらないときは null。 */
  area: hazardAlertAreaSchema.nullable(),
  alertLevel: alertLevelSchema,
  /** カードや地図で使う危険度（警戒レベル相当からの写像）。 */
  level: hazardLevelSchema,
  headlineJa: z.string(),
  warnings: z.array(hazardAlertWarningSchema),
  /** その区域を対象にした指定河川洪水予報（発表中のものだけ）。 */
  floodForecasts: z.array(hazardFloodForecastSchema),
  reasonsJa: z.array(z.string()),
  /** 気象庁の発表時刻。**10 分前の情報を「今」と言わない**ため必ず出す（§7.4）。 */
  reportedAt: z.string().nullable(),
  /** **この判定に含まれていないもの**（市町村が出す避難情報）。必ず表示する。 */
  limitationsJa: z.array(z.string()),
  sources: z.array(sourceRefSchema),
  notesJa: z.array(z.string()),
  disclaimerJa: z.string(),
})
export type HazardAlertsResponse = z.infer<typeof hazardAlertsResponseSchema>

// --- ハザード：避難先（GET /api/hazard/evacuation・260824_flood §3.5・§8.5） ------

/**
 * 災害種別は**必須**にする。既定で「洪水」に倒すと、土砂災害を心配している人に
 * **洪水にしか対応していない避難場所**を返しうる（§11 リスク 10 ＝人命）。
 * 呼び出し側（UI もチャットも）が必ず選ぶ。
 */
export const hazardEvacuationQuerySchema = z.object({
  lon: queryNumber(-180, 180),
  lat: queryNumber(-90, 90),
  for: evacuationDisasterKeySchema,
  placeJa: z.string().min(1).max(60).optional(),
  radiusM: queryNumber(500, 20_000).optional(),
  top: queryNumber(1, 20).optional(),
})
export type HazardEvacuationQuery = z.infer<typeof hazardEvacuationQuerySchema>

/** 想定区域との重なり方（`shared/hazard-mesh` の `CellCertainty` と同値）。 */
export const hazardCertaintyOfAreaSchema = z.enum(['outside', 'partial', 'inside'])

/** 避難先 1 件（意味づけ済み。UI も AI もこの形だけを読む）。 */
export const hazardEvacuationSiteSchema = z.object({
  nameJa: z.string(),
  addressJa: z.string(),
  lon: z.number(),
  lat: z.number(),
  distanceM: z.number().int(),
  /** 「約1.2km」。UI と AI で言い方を変えないよう、文字列もサーバが作る。 */
  distanceJa: z.string(),
  /** 八方位（「北東」）。地図が見られない状況でも動ける情報にする。 */
  bearingJa: z.string(),
  /** その場所が指定されている災害種別（表示名）。**洪水だけとは限らない。** */
  disastersJa: z.array(z.string()),
  /**
   * **その災害の**想定区域との重なり方（`null`＝判定できない）。
   * **真偽値にしない**——言い切れるのは両端だけである（§5.9）。
   */
  hazardAreaCertainty: hazardCertaintyOfAreaSchema.nullable(),
  /**
   * どこから読んだか（§6.3 の優先順位）。`tile`＝公式タイルの画素（点そのもの・地図と同じ）、
   * `mesh`＝250m メッシュ（区間でしか言えない）。判定できなければ null。
   * **同じ `inside` でも意味の強さが違う**ので、確からしさと一緒に運ぶ。
   */
  hazardAreaSource: z.enum(['tile', 'mesh']).nullable(),
  /** 上の重なり方の日本語（UI と AI で言い方を割らないよう、サーバが作る）。 */
  hazardAreaJa: z.string(),
  /** 当たった区域の名前（「土砂災害警戒区域（イエローゾーン）」など）。無ければ null。 */
  hazardAreaDetailJa: z.string().nullable(),
  elevationM: z.number().nullable(),
  remarksJa: z.string().nullable(),
})
export type HazardEvacuationSite = z.infer<typeof hazardEvacuationSiteSchema>

/** 避難先の一覧（`/api/hazard/evacuation` と AI ツール `findEvacuationSites` が共有）。 */
export const hazardEvacuationResponseSchema = z.object({
  point: z.object({ lon: z.number(), lat: z.number(), placeJa: z.string() }),
  forDisaster: evacuationDisasterKeySchema,
  forDisasterJa: z.string(),
  /** 「指定緊急避難場所」。滞在する「指定避難所」と混同させないため、応答に必ず入れる。 */
  siteKindJa: z.string(),
  searchRadiusM: z.number().int(),
  headlineJa: z.string(),
  sites: z.array(hazardEvacuationSiteSchema),
  /** **必ず全部表示する**（開設状況は分からない・直線距離である・指定避難所ではない…）。 */
  limitationsJa: z.array(z.string()),
  notesJa: z.array(z.string()),
  sources: z.array(sourceRefSchema),
  disclaimerJa: z.string(),
})
export type HazardEvacuationResponse = z.infer<typeof hazardEvacuationResponseSchema>

// --- ハザード：脱出方向（GET /api/hazard/escape・260824_flood §8.6） ------

/** 災害種別は**必須**（避難先と同じ理由・§11 リスク 10）。 */
export const hazardEscapeQuerySchema = z.object({
  lon: queryNumber(-180, 180),
  lat: queryNumber(-90, 90),
  for: evacuationDisasterKeySchema,
  placeJa: z.string().min(1).max(60).optional(),
})
export type HazardEscapeQuery = z.infer<typeof hazardEscapeQuerySchema>

/** いちばん近い「区域の外」の向き。**経路ではなく方向と直線距離だけ**（§0.4）。 */
export const hazardEscapeDirectionSchema = z.object({
  /** 八方位（「北東」）。地図が見られない状況でも動ける情報にする。 */
  bearingJa: z.string(),
  distanceM: z.number().int(),
  /** 「約620m」。UI と AI で言い方を割らないよう、サーバが作る。 */
  distanceJa: z.string(),
  /** 目標セルの中心（地図に印を出せる）。 */
  lon: z.number(),
  lat: z.number(),
})
export type HazardEscapeDirection = z.infer<typeof hazardEscapeDirectionSchema>

/**
 * 脱出方向（`/api/hazard/escape` と AI ツール `findEscapeDirection` が共有）。
 *
 * ⚠ **これは経路案内ではない。** `limitationsJa` を落とすと、方向と距離だけが独り歩きする。
 */
export const hazardEscapeResponseSchema = z.object({
  point: z.object({ lon: z.number(), lat: z.number(), placeJa: z.string() }),
  forDisaster: evacuationDisasterKeySchema,
  /** 「洪水の想定区域」。見出しにも使う。 */
  forDisasterJa: z.string(),
  /**
   * 起点がその区域の中にあったか（外なら方向は要らない）。
   * **`null` は「判定できない」**——メッシュを持たない災害・読めなかった区画。
   */
  inside: z.boolean().nullable(),
  /** 見つからなかったときは null（**「無い」という意味ではない**）。 */
  direction: hazardEscapeDirectionSchema.nullable(),
  searchRadiusM: z.number().int(),
  headlineJa: z.string(),
  /** **必ず全部表示する**（直線距離である・移動が安全とは限らない・250m の目安…）。 */
  limitationsJa: z.array(z.string()),
  notesJa: z.array(z.string()),
  sources: z.array(sourceRefSchema),
  disclaimerJa: z.string(),
})
export type HazardEscapeResponse = z.infer<typeof hazardEscapeResponseSchema>

export const healthResponseSchema = z.object({ ok: z.literal(true) })
export type HealthResponse = z.infer<typeof healthResponseSchema>
