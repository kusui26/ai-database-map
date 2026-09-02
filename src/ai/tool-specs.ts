/**
 * ツールの**純粋定義**（単一の真実・`docs/260828_research_claude_auth.md` §4.2 PR-1）。
 *
 * ここには「名前・説明・入力スキーマ・実行」だけを置き、**AI SDK にも EffectCollector にも
 * 依存しない**。`run` は副産物（Effect）と LLM 向け要約を**値として返す**——押し込む先
 * （Gemini なら収集器、MCP なら `structuredContent`）は消費側のアダプタが決める。
 *
 * - Gemini（AI SDK）: `tools.ts` が `tool()` に具象スキーマのまま渡し、実行は
 *   `executeFromSpec` が包む（挙動は分離前と同一）
 * - MCP（PR-2 予定）: 同じ Spec から `registerTool` を生成する
 *
 * 定義を二重に持たない（CLAUDE.md §3 DRY）。**文言・スキーマをここ以外に書かない。**
 */

import { z } from 'zod'
import { categorySchema, requireEntry } from '@/shared/catalog'
import {
  PREFECTURES,
  RADII_M,
  type Category,
  type RadiusM,
  ROUTE_TYPES,
  routeTypeLabel,
} from '@/shared/constants'
import {
  type GrowthResponse,
  type HazardAlertsResponse,
  type HazardEscapeResponse,
  type HazardEvacuationResponse,
  type HazardPointResponse,
  type RankingResponse,
  type StationListItem,
} from '@/shared/api'
import {
  DATASET_MAX_VALUE_COLUMNS,
  resolveDatasetColumns,
  type DatasetColumnsError,
  type DatasetColumnsOk,
} from './dataset/columns'
import {
  datasetNotes,
  datasetPreview,
  datasetRowCount,
  type DatasetShape,
  type DatasetValues,
} from './dataset/csv'
import {
  datasetSecret,
  signDatasetToken,
  type DatasetQuery,
  type DatasetSelector,
} from './dataset/token'
import {
  HAZARD_DATASET_COLUMNS,
  hazardCsvCells,
  SUMMARY_HAZARD_GROUPS,
  type HazardGroupSummary,
} from '@/shared/hazard-summary'
import { HAZARD_SUMMARY_LIMITATIONS_JA, hazardSummarySources } from '@/domain/hazard/summary'
import { evacuationDisasterKeySchema, EVACUATION_DISASTERS } from '@/shared/evacuation'
import {
  datasetRows,
  listStations,
  rankByColumn,
  searchStations,
  stationBundle,
  stationByGrp,
  stationHazardSummaries,
  scatterPoints,
  type ListStationsFilter,
  type StationHazardRow,
} from '@/db/queries'
import { buildStationDetail } from '@/domain/stations/presenter'
import { buildRanking } from '@/domain/ranking/presenter'
import { buildGrowth } from '@/domain/growth/presenter'
import { hazardPointAt } from '@/lib/hazard/point-source'
import { hazardAlertsAt } from '@/lib/hazard/alert-source'
import { evacuationSitesAt } from '@/lib/hazard/evacuation-source'
import { escapeDirectionAt } from '@/lib/hazard/escape-source'
import { reportedAtJa } from '@/domain/hazard/panels'
import { type StationDetailEffect, type ToolEffect } from './types'
import { panelsForStationDetail, summarizePanels } from './assemble'
import { metricsCatalogDigest } from './catalog-digest'
import { resolveMetricKey, type MetricResolution } from './metric-resolver'

/** 既定の集約半径（1km＝アプリ既定）。 */
const DEFAULT_RADIUS_M: RadiusM = 1000
/** ランキング既定件数。 */
const DEFAULT_RANK_LIMIT = 20
/** ランキング最大件数（チャット内は上位に絞る）。 */
const MAX_RANK_LIMIT = 50

/** LLM へ渡す河川の件数（浸水ナビ）。深い順に上位だけで、判断には十分。 */
const MAX_RIVERS_FOR_LLM = 3
/** LLM へ渡す根拠の文の数（§6.5）。 */
const MAX_REASONS_FOR_LLM = 3

/** 事業者種別コードの説明（ツール定義に埋め込む・表示名は constants の単一定義から生成）。 */
const ROUTE_TYPE_HINT = ROUTE_TYPES.map((type) => `${type}:${routeTypeLabel(type)}`).join(' ')

/** 実行の文脈（消費側が渡す）。`origin`＝共通API の絶対 URL を組むための自ホスト。 */
export type ToolRunContext = {
  readonly origin: string
}

/** `run` の返り値：副産物（順序どおり）と、LLM に見せる要約。 */
export type ToolRunResult<Out> = {
  readonly effects: readonly ToolEffect[]
  readonly forLlm: Out
}

/**
 * 1 ツールの純粋定義。
 *
 * `errorFallbackJa` は「実行が**投げた**ときに使う言い訳」。`null` は捕捉しない
 * （純粋な照会だけ）。構造化エラー（`{ error, hint }` 等）は例外ではなく
 * **`forLlm` として返す**——LLM に次の一手を伝えるための正常な応答だから。
 */
export type ToolSpec<Schema extends z.ZodTypeAny, Out> = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Schema
  readonly errorFallbackJa: string | null
  readonly run: (input: z.output<Schema>, ctx: ToolRunContext) => Promise<ToolRunResult<Out>>
}

/** 型推論の入口（`TOOL_SPECS` の各値をリテラルどおりに固定する）。 */
function defineSpec<Schema extends z.ZodTypeAny, Out>(
  spec: ToolSpec<Schema, Out>,
): ToolSpec<Schema, Out> {
  return spec
}

/** 副産物なしの返り値（検索・カタログ照会・構造化エラー）。 */
function pure<Out>(forLlm: Out): ToolRunResult<Out> {
  return { effects: [], forLlm }
}

/** 構造化エラー（次の一手つき）。例外ではなく `forLlm` として返す正常な応答。 */
type HintErrorJa = { error: string; hint: string }

/** `stationByGrp` の 1 行（null を除いた形）。 */
type StationRow = NonNullable<Awaited<ReturnType<typeof stationByGrp>>>

/** list_stations の既定・上限（RPC 側の least/greatest と同じ値・ずらさない）。 */
const LIST_DEFAULT_LIMIT = 300
const LIST_MAX_LIMIT = 2000

/** 名前配列の前後空白を落とし、空文字を除く（会社名・路線名の共通前処理）。 */
function nonEmptyNames(input: readonly string[] | undefined): string[] {
  return (input ?? []).map((name) => name.trim()).filter((name) => name.length > 0)
}

/** 入力の半径を有効な集約半径に解決（未知は既定 1km）。 */
function resolveRadius(input: number | undefined): RadiusM {
  const found = RADII_M.find((radius) => radius === input)
  return found ?? DEFAULT_RADIUS_M
}

/**
 * 都道府県名を正規化する。厳密一致か「接尾辞（都/道/府/県）抜き」の一致のみ採用し（"神奈川"→"神奈川県"）、
 * それ以外は unknown に集める（曖昧な部分一致で誤県に寄せない＝素通しして 0 件になる混乱を防ぐ）。
 */
function normalizePrefectures(input: readonly string[]): { names: string[]; unknown: string[] } {
  const names: string[] = []
  const unknown: string[] = []
  for (const raw of input) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const exact = PREFECTURES.find((pref) => pref.name === trimmed)
    if (exact !== undefined) {
      names.push(exact.name)
      continue
    }
    const stripped = PREFECTURES.find((pref) => pref.name.replace(/[都道府県]$/, '') === trimmed)
    if (stripped !== undefined) {
      names.push(stripped.name)
      continue
    }
    unknown.push(trimmed)
  }
  return { names, unknown }
}

/** 未知の都道府県に対する構造化エラー（LLM に正式名で再指定させる）。 */
function unknownPrefectures(unknown: readonly string[]): { error: string; hint: string } {
  return {
    error: `未知の都道府県: ${unknown.join('・')}`,
    hint: '都道府県は正式名（例「神奈川県」「東京都」）で指定してください。',
  }
}

/** near セレクタの半径の下限・上限（m）。 */
const NEAR_MIN_RADIUS_M = 100
const NEAR_MAX_RADIUS_M = 100_000

/** build_dataset の grps 指定の上限（署名 URL に埋め込むため・URL 長の実用範囲）。 */
const DATASET_MAX_GRPS = 500
/** build_dataset のセレクタ既定上限（対象集合は原則全件＝RPC 上限まで）。 */
const DATASET_DEFAULT_STATION_LIMIT = LIST_MAX_LIMIT
/** get_hazard_summary の grps 上限（RPC 側 limit と同値・§5.3 ③）。 */
const HAZARD_SUMMARY_MAX_GRPS = 500

/**
 * 対象集合セレクタ（listStations と buildDataset.stations で**同一**・§5.3 の共通化）。
 * operators/routes/routeTypes の述語は rank/scatter と同じ station_matches_filters（DB 側で共有）。
 */
const stationSelectorSchema = z.object({
  prefectures: z
    .array(z.string())
    .optional()
    .describe('都道府県名の配列（正式名・例 ["神奈川県"]）。省略で全国'),
  municipality: z
    .string()
    .optional()
    .describe('市区町村名の前方一致（例: 横浜市、世田谷区）。JIS コードの前方一致も可'),
  operators: z
    .array(z.string())
    .optional()
    .describe(
      '運営会社名の配列（正式名称・例 ["東日本旅客鉄道"]。JR東日本ではない）。どれか1社でも運営する駅が対象。省略で全社',
    ),
  routes: z
    .array(z.string())
    .optional()
    .describe('路線名の配列（例 ["東海道新幹線"]）。省略で全路線'),
  routeTypes: z
    .array(z.number().int())
    .optional()
    .describe(`事業者種別の配列（${ROUTE_TYPE_HINT}）。routes とは OR。省略で全種別`),
  bbox: z
    .array(z.number())
    .length(4)
    .optional()
    .describe('地図範囲 [west, south, east, north]（経度・緯度）'),
  near: z
    .object({ lon: z.number(), lat: z.number(), radiusM: z.number() })
    .optional()
    .describe(`中心座標と半径(m)で絞る（半径 ${NEAR_MIN_RADIUS_M}〜${NEAR_MAX_RADIUS_M}）`),
  limit: z
    .number()
    .int()
    .optional()
    .describe(`件数上限（既定 ${LIST_DEFAULT_LIMIT}・最大 ${LIST_MAX_LIMIT}。乗降客数の多い順）`),
})
type StationSelector = z.output<typeof stationSelectorSchema>

type SelectorResolution =
  | { readonly ok: true; readonly filter: ListStationsFilter; readonly requested: number }
  | { readonly ok: false; readonly error: HintErrorJa }

/** セレクタ → DB フィルタ（正規化と検証。曖昧・不正は構造化エラーで返す）。 */
function selectorToFilter(input: StationSelector, defaultLimit: number): SelectorResolution {
  const { names: prefs, unknown } = normalizePrefectures(input.prefectures ?? [])
  if (unknown.length > 0) return { ok: false, error: unknownPrefectures(unknown) }
  let bbox: ListStationsFilter['bbox']
  if (input.bbox !== undefined) {
    const [west, south, east, north] = input.bbox
    if (west === undefined || south === undefined || east === undefined || north === undefined) {
      return {
        ok: false,
        error: {
          error: 'bbox が不正です',
          hint: 'bbox は [west, south, east, north] の 4 値です。',
        },
      }
    }
    if (!(west < east && south < north)) {
      return {
        ok: false,
        error: {
          error: 'bbox の範囲が不正です',
          hint: '[west, south, east, north]（経度・緯度）で west < east・south < north にしてください。',
        },
      }
    }
    bbox = { west, south, east, north }
  }
  const near =
    input.near === undefined
      ? undefined
      : {
          lon: input.near.lon,
          lat: input.near.lat,
          radiusM: Math.min(Math.max(input.near.radiusM, NEAR_MIN_RADIUS_M), NEAR_MAX_RADIUS_M),
        }
  const municipality = input.municipality?.trim()
  const requested = Math.min(Math.max(input.limit ?? defaultLimit, 1), LIST_MAX_LIMIT)
  return {
    ok: true,
    requested,
    filter: {
      prefectures: prefs,
      municipality: municipality === undefined || municipality === '' ? undefined : municipality,
      operators: nonEmptyNames(input.operators),
      routes: nonEmptyNames(input.routes),
      routeTypes: (input.routeTypes ?? []).filter((type) => ROUTE_TYPES.some((t) => t === type)),
      bbox,
      near,
      limit: requested,
    },
  }
}

/** 正規化済みフィルタ → 署名トークンに埋めるセレクタ（空の条件は載せない）。 */
function tokenSelectorOf(filter: ListStationsFilter, requested: number): DatasetSelector {
  const nonEmpty = <T>(values: readonly T[] | undefined): T[] | undefined =>
    values !== undefined && values.length > 0 ? [...values] : undefined
  return {
    prefectures: nonEmpty(filter.prefectures),
    municipality: filter.municipality,
    operators: nonEmpty(filter.operators),
    routes: nonEmpty(filter.routes),
    routeTypes: nonEmpty(filter.routeTypes),
    bbox: filter.bbox === undefined ? undefined : { ...filter.bbox },
    near: filter.near === undefined ? undefined : { ...filter.near },
    limit: requested,
  }
}

/** 指標の解決失敗 → LLM 向けの構造化エラー（次の一手を hint で示す）。 */
function metricError(resolution: Extract<MetricResolution, { ok: false }>): {
  error: string
  hint: string
  didYouMean: readonly string[]
} {
  return { error: resolution.error, hint: resolution.hint, didYouMean: resolution.didYouMean }
}

/** 解決時の補正・既定の説明をまとめる（無ければ undefined＝返却に含めない）。 */
function resolutionNote(...notes: readonly (string | null)[]): string | undefined {
  const merged = notes.filter((note): note is string => note !== null && note.length > 0)
  return merged.length > 0 ? merged.join('・') : undefined
}

/** ハザードを調べる地点（駅 grp か緯度経度）。駅なら座標と呼び名を DB から解決する。 */
async function resolveHazardTarget(input: {
  grp?: string
  lon?: number
  lat?: number
  placeJa?: string
}): Promise<{ lon: number; lat: number; placeJa: string } | HintErrorJa> {
  if (input.grp !== undefined) {
    const station = await stationByGrp(input.grp)
    if (station === null)
      return {
        error: `駅が見つかりません: ${input.grp}`,
        hint: 'searchStations で grp を取り直してください。',
      }
    return { lon: station.lon, lat: station.lat, placeJa: input.placeJa ?? station.label }
  }
  if (input.lon === undefined || input.lat === undefined) {
    return {
      error: '地点を特定できません',
      hint: '駅なら grp を、任意地点なら lon と lat の両方を指定してください。',
    }
  }
  return { lon: input.lon, lat: input.lat, placeJa: input.placeJa ?? 'この地点' }
}

/**
 * 駅一覧 → LLM 向けの要約（**識別子と位置だけ**・値は返さない・§5.3）。
 * 件数が要求上限に達したら truncated（全域を返した保証が無いことを LLM に伝える）。
 */
function listStationsForLlm(
  stations: Awaited<ReturnType<typeof listStations>>,
  requested: number,
  note?: string,
) {
  return {
    count: stations.length,
    truncated: stations.length >= requested,
    ...(note === undefined ? {} : { note }),
    stations: stations.map((station) => ({
      grp: station.grp,
      name: station.label,
      prefecture: station.prefecture,
      municipality: station.municipality,
      lon: station.lon,
      lat: station.lat,
    })),
  }
}

/** 列解決の失敗 → LLM 向けの構造化エラー（ok を落として次の一手だけ渡す）。 */
function columnsError(result: DatasetColumnsError): {
  error: string
  hint: string
  didYouMean: readonly string[]
} {
  return { error: result.error, hint: result.hint, didYouMean: result.didYouMean }
}

/** include_hazard の結合結果（事前計算テーブル由来・欠けは missing に列挙）。 */
type HazardJoin = {
  readonly cellsByGrp: ReadonlyMap<string, Readonly<Record<string, string | number>>>
  readonly missing: readonly string[]
  readonly version: number | null
  readonly computedAt: string | null
}

/** 駅別ハザードサマリを CSV セルの形で引く（≤2000 駅・RPC は 500 件ずつ合流）。 */
async function hazardJoinFor(stations: readonly StationListItem[]): Promise<HazardJoin> {
  const grps = stations.map((station) => station.grp)
  const rows = await stationHazardSummaries(grps)
  const cellsByGrp = new Map(rows.map((row) => [row.grp, hazardCsvCells(row.summary)]))
  return {
    cellsByGrp,
    missing: grps.filter((grp) => !cellsByGrp.has(grp)),
    version: rows[0]?.version ?? null,
    computedAt: rows[0]?.computedAt ?? null,
  }
}

/** 指標の値にハザード列を継ぎ足す（未計算の駅はハザード列だけ空欄になる）。 */
function withHazardValues(values: DatasetValues, hazard: HazardJoin): DatasetValues {
  const merged: Record<string, Record<string, string | number>> = {}
  for (const [grp, cells] of hazard.cellsByGrp) {
    merged[grp] = { ...(values[grp] ?? {}), ...cells }
  }
  return { ...values, ...merged }
}

/** include_hazard の注意書き（黙って合成させない・§5.3 ③）。 */
function hazardJoinNotes(hazard: HazardJoin): readonly string[] {
  const notes = [
    `ハザード列（hazard_*）は事前計算（version ${hazard.version ?? '?'}・${hazard.computedAt ?? '?'} 時点）。レベルは順序尺度で足し算できない。none は図上の該当なし・*_uncovered=1 は区域図なし（安全とは言えない）。`,
  ]
  if (hazard.missing.length > 0) {
    notes.push(`ハザード未計算の駅 ${hazard.missing.length} 件（該当列は空欄）`)
  }
  return notes
}

/** グループ要約 → LLM 向けの圧縮形（該当なし・近接なし・図ありは省く＝500 駅でも軽く）。 */
function compactGroupForLlm(
  each: HazardGroupSummary,
): { level: string; worstJa?: string; nearby?: true; uncovered?: true } | undefined {
  if (each.level === 'none' && !each.nearby && !each.uncovered) return undefined
  return {
    level: each.level,
    ...(each.worstJa === null ? {} : { worstJa: each.worstJa }),
    ...(each.nearby ? { nearby: true as const } : {}),
    ...(each.uncovered ? { uncovered: true as const } : {}),
  }
}

/** 駅別ハザード一括 → LLM 向けの要約（限界と出典を**必ず**同梱・§5.3 ③）。 */
function hazardSummaryBulkForLlm(requested: readonly string[], rows: readonly StationHazardRow[]) {
  const found = new Set(rows.map((row) => row.grp))
  const missing = requested.filter((grp) => !found.has(grp))
  return {
    version: rows[0]?.version ?? null,
    computedAt: rows[0]?.computedAt ?? null,
    count: rows.length,
    ...(missing.length > 0 ? { missingCount: missing.length, missing: missing.slice(0, 20) } : {}),
    stations: rows.map(({ summary }) => {
      const hazards: Record<string, NonNullable<ReturnType<typeof compactGroupForLlm>>> = {}
      for (const group of SUMMARY_HAZARD_GROUPS) {
        const compact = compactGroupForLlm(summary.groups[group])
        if (compact !== undefined) hazards[group] = compact
      }
      return {
        grp: summary.grp,
        level: summary.level,
        evacuation: summary.evacuation,
        elevM: summary.elevationM,
        ...(Object.keys(hazards).length > 0 ? { hazards } : {}),
      }
    }),
    limitationsJa: HAZARD_SUMMARY_LIMITATIONS_JA,
    sources: hazardSummarySources(),
  }
}

/**
 * データセット生成 → LLM 向けの要約（**スキーマとプレビューだけ**・値は URL の CSV に・§5.3）。
 * notes に「既定で埋めた事実」「欠損・フラグ」「見つからない grp」を全部載せる——黙って使わせない。
 */
function buildDatasetForLlm(args: {
  stations: readonly StationListItem[]
  values: DatasetValues
  resolved: DatasetColumnsOk
  hazard: HazardJoin | null
  shape: DatasetShape
  urls: { url: string; metaUrl: string; expiresAtMs: number }
  truncated: boolean
  extraNotes: readonly string[]
}) {
  const { stations, values, resolved, hazard, shape } = args
  const hazardColumns = hazard === null ? [] : HAZARD_DATASET_COLUMNS
  const csvColumns = [...resolved.columns, ...hazardColumns]
  return {
    stationCount: stations.length,
    rowCount: datasetRowCount(stations, values, csvColumns, shape),
    shape,
    truncated: args.truncated,
    url: args.urls.url,
    metaUrl: args.urls.metaUrl,
    expiresAt: new Date(args.urls.expiresAtMs).toISOString(),
    columns: [
      ...resolved.columns.map((column) => ({
        key: column.key,
        role: column.role,
        label: column.labelJa,
        unit: column.unit,
        year: column.year,
        yearBase: column.yearBase,
        radiusM: column.radiusM,
        flag: column.reliabilityFlagKey,
      })),
      ...hazardColumns.map((column) => ({
        key: column.key,
        role: column.role,
        label: column.labelJa,
        unit: column.unit,
        year: null,
        yearBase: null,
        radiusM: null,
        flag: null,
      })),
    ],
    preview: datasetPreview(stations, values, csvColumns, shape),
    notes: [
      ...resolved.notes,
      ...datasetNotes(stations, values, csvColumns),
      ...(hazard === null ? [] : hazardJoinNotes(hazard)),
      ...args.extraNotes,
    ],
  }
}

/**
 * 駅詳細 → LLM 向けの要約（パネル要約と同じ文字列を通す）。
 * run の返り型を明示するために関数へ切り出してある（分岐と型推論の分離）。
 */
function stationDetailForLlm(
  station: StationRow,
  resolved: RadiusM,
  category: Category | undefined,
  effect: StationDetailEffect,
) {
  return {
    grp: station.grp,
    name: station.label,
    prefecture: station.prefecture,
    operators: station.operators,
    radius: resolved,
    category: category ?? 'passenger',
    summary: summarizePanels(panelsForStationDetail(effect)),
  }
}

/** ランキング → LLM 向けの要約（上位 10 行に絞る）。 */
function rankingForLlm(
  resolvedKey: string,
  note: string | undefined,
  dir: 'asc' | 'desc',
  response: RankingResponse,
) {
  return {
    metric: response.metric.labelJa,
    resolvedMetric: resolvedKey,
    note,
    unit: response.metric.unit,
    prefectures: response.prefectures,
    operators: response.operators,
    routes: response.routes,
    routeTypes: response.routeTypes.map(routeTypeLabel),
    order: dir,
    total: response.total,
    rows: response.rows.slice(0, 10).map((row) => ({
      rank: row.rank,
      name: row.name,
      prefecture: row.prefecture,
      value: row.formatted,
      flagged: row.flagged,
    })),
  }
}

/** 散布 → LLM 向けの要約（点は数だけ・座標は渡さない）。 */
function growthForLlm(
  xKey: string,
  yKey: string,
  note: string | undefined,
  response: GrowthResponse,
) {
  return {
    x: response.x.labelJa,
    y: response.y.labelJa,
    resolvedMetrics: { x: xKey, y: yKey },
    note,
    prefectures: response.prefectures,
    operators: response.operators,
    routes: response.routes,
    routeTypes: response.routeTypes.map(routeTypeLabel),
    pointCount: response.points.length,
    clusterCount: response.clusterCount,
    excludedLowN: response.excludedLowN,
  }
}

/**
 * 応答 → LLM 向けの要約。**パネルと同じ文字列だけを渡す**（本文とカードがズレない）。
 * `coverageNotesJa` を削らないのは、「白＝安全ではない」を LLM に忘れさせないため（§7.5-2）。
 */
function hazardSummaryForLlm(point: HazardPointResponse) {
  return {
    placeJa: point.point.placeJa,
    meshCode: point.mesh.code,
    level: point.verdict.level,
    headlineJa: point.verdict.headlineJa,
    evacuation: point.verdict.evacuation,
    certainty: point.certainty,
    elevMeanM: point.terrain.elevMeanM,
    hazards: point.hazards.map((item) => ({
      labelJa: item.labelJa,
      valueJa: item.valueJa,
      level: item.level,
      source: item.source,
    })),
    rivers: point.rivers.slice(0, MAX_RIVERS_FOR_LLM),
    reasonsJa: point.verdict.reasonsJa.slice(0, MAX_REASONS_FOR_LLM),
    coverageNotesJa: point.coverageNotesJa,
    notesJa: point.notesJa,
    disclaimerJa: point.disclaimerJa,
  }
}

/**
 * アラートの応答 → LLM 向けの要約。
 * **`limitationsJa` を削らない**——「レベル2相当」を「レベル4は出ていない」と読ませないための 1 文で、
 * これを落とすと誤った安心を作る（§7.5）。
 */
function alertSummaryForLlm(alerts: HazardAlertsResponse) {
  return {
    placeJa: alerts.point.placeJa,
    areaJa: alerts.area === null ? null : alerts.area.areas.map((area) => area.nameJa).join('・'),
    municipalityJa: alerts.area?.municipalityJa ?? null,
    alertLevel: alerts.alertLevel,
    level: alerts.level,
    headlineJa: alerts.headlineJa,
    warnings: alerts.warnings.map((warning) => ({
      nameJa: warning.nameJa,
      alertLevel: warning.alertLevel,
      statusJa: warning.statusJa,
      areaJa: warning.areaJa,
      detailJa: warning.detailJa,
    })),
    // 指定河川洪水予報（氾濫危険情報など）。**河川名を落とさない**——いちばん具体的な情報なので。
    floodForecasts: alerts.floodForecasts,
    // 生の ISO ではなく**読める形**で渡す（そのまま本文に出るので）。
    reportedAtJa: reportedAtJa(alerts.reportedAt),
    limitationsJa: alerts.limitationsJa,
    notesJa: alerts.notesJa,
    disclaimerJa: alerts.disclaimerJa,
  }
}

/**
 * 避難先 → LLM 向けの要約（同 §8.5）。
 *
 * **`limitationsJa` を削らない**——「開設されているとは限らない」「直線距離である」
 * 「指定避難所ではない」の 3 つは、落ちた瞬間に誤解が生まれる（§11 リスク 10）。
 * 距離・方角・区域との重なりは**サーバが作った日本語**をそのまま渡す（LLM に計算させない）。
 */
function evacuationSummaryForLlm(evacuation: HazardEvacuationResponse) {
  return {
    placeJa: evacuation.point.placeJa,
    forDisasterJa: evacuation.forDisasterJa,
    siteKindJa: evacuation.siteKindJa,
    headlineJa: evacuation.headlineJa,
    sites: evacuation.sites.map((site) => ({
      nameJa: site.nameJa,
      addressJa: site.addressJa,
      distanceJa: site.distanceJa,
      bearingJa: site.bearingJa,
      hazardAreaJa: site.hazardAreaJa,
      hazardAreaDetailJa: site.hazardAreaDetailJa,
      elevationM: site.elevationM,
      remarksJa: site.remarksJa,
      disastersJa: site.disastersJa,
    })),
    notesJa: evacuation.notesJa,
    limitationsJa: evacuation.limitationsJa,
    disclaimerJa: evacuation.disclaimerJa,
  }
}

/**
 * 脱出方向 → LLM 向けの要約（同 §8.6）。
 *
 * **`limitationsJa` を削らない**——直線距離であること・移動が安全とは限らないことが落ちると、
 * 方向と距離だけが独り歩きして**経路案内**になる。方向も距離もサーバが作った文字列を渡す。
 */
function escapeSummaryForLlm(escape: HazardEscapeResponse) {
  return {
    placeJa: escape.point.placeJa,
    forDisasterJa: escape.forDisasterJa,
    inside: escape.inside,
    headlineJa: escape.headlineJa,
    direction:
      escape.direction === null
        ? null
        : {
            bearingJa: escape.direction.bearingJa,
            distanceJa: escape.direction.distanceJa,
          },
    notesJa: escape.notesJa,
    limitationsJa: escape.limitationsJa,
    disclaimerJa: escape.disclaimerJa,
  }
}

/**
 * 全ツールの純粋定義。キーは Gemini のツール名（camelCase）。
 * ⚠ MCP のツール名（snake_case・ASCII 制約）への写像は PR-2 のアダプタが持つ——
 * ここに二重の名前を置かない。
 */
export const TOOL_SPECS = {
  /** 駅名 → 候補駅（grp を得る起点）。 */
  searchStations: defineSpec({
    name: 'searchStations',
    description:
      '駅名（漢字・一部かな可）から駅を検索し候補を返す。駅を特定する最初の一歩。返る grp を getStationDetail に渡す。',
    inputSchema: z.object({
      query: z.string().min(1).describe('駅名。例: 東京、しんじゅく、尼崎'),
    }),
    errorFallbackJa: '検索に失敗しました',
    run: async ({ query }) => {
      const results = await searchStations(query)
      // LLM は grp を選ぶだけ（座標・詳細は getStationDetail 側で取得）＝返却は最小限に。
      return pure({
        count: results.length,
        candidates: results.slice(0, 8).map((station) => ({
          grp: station.grp,
          name: station.searchLabel ?? station.label,
          prefecture: station.prefecture,
          paxLatest: station.paxLatest,
        })),
      })
    },
  }),

  /** 条件（都道府県・市区町村・会社・路線・範囲）→ 駅の一覧（対象集合づくり・値は返さない）。 */
  listStations: defineSpec({
    name: 'listStations',
    description:
      '条件に合う駅の一覧（grp・駅名・位置だけ）を返す。「横浜市の駅」「神奈川県の駅」「東急電鉄の駅」のような対象集合づくりの起点。' +
      'municipality は市区町村名の前方一致（例「横浜市」で全区を束ねる。「世田谷区」も可）。operators / routes / routeTypes・bbox・near でも絞れる（条件は AND・routes と routeTypes は OR）。値の取得や比較は他のツールで行う。',
    inputSchema: stationSelectorSchema,
    errorFallbackJa: '駅一覧の取得に失敗しました',
    run: async (
      input,
    ): Promise<ToolRunResult<HintErrorJa | ReturnType<typeof listStationsForLlm>>> => {
      const resolved = selectorToFilter(input, LIST_DEFAULT_LIMIT)
      if (!resolved.ok) return pure(resolved.error)
      const stations = await listStations(resolved.filter)
      // 綴り違いは 0 件になるだけで区別がつかない（rank と同じ扱い・260903）。
      // 名称の当てずっぽう再試行ループを防ぐため、次の一手を note で示す。
      const emptyNote =
        stations.length === 0 &&
        ((resolved.filter.routes?.length ?? 0) > 0 || (resolved.filter.operators?.length ?? 0) > 0)
          ? '該当 0 件でした。路線名はデータの正式名称で会社名を含まない形（例「東横線」「東海道新幹線」）、会社名は operators に正式名称（例「東急電鉄」）。0 件が続くときは operators だけで会社の全駅を取得してください。'
          : undefined
      return pure(listStationsForLlm(stations, resolved.requested, emptyNote))
    },
  }),

  /**
   * 駅×指標の横持ちデータセット（CSV・短命の署名 URL）。§5.3 の分析グレード本体。
   * 応答は**スキーマとプレビューだけ**——値は URL の CSV にあり、分析はローカル（pandas 等）で行う。
   */
  buildDataset: defineSpec({
    name: 'buildDataset',
    description:
      '多数の駅 × 複数指標のデータセット（CSV）を 1 回で作り、短命のダウンロード URL を返す。' +
      '複数駅の比較・スコアリング・相関などの分析は getStationDetail の繰り返しではなくこれを使い、CSV をローカル（pandas 等）で分析する。' +
      'stations（listStations と同じセレクタ）か grps のどちらか一方で対象を指定。' +
      `metrics はカタログキー（例 pop_2020_1km）でも指標ファミリ（例 pop, pop_gr, lp_med, rate_covid）でもよく、ファミリは radiusM / years で確定（既定 1km・直近。値列は最大 ${DATASET_MAX_VALUE_COLUMNS}）。` +
      '値列の信頼性フラグ列（1=注意）は自動で同伴する。includeHazard: true で駅別ハザードサマリ（事前計算・順序尺度）を hazard_ 接頭辞の列として結合できる（線形加点しない・meta の limitations を読む）。' +
      '応答は列スキーマ・先頭 5 行・注意だけで、値は url の CSV に、列の意味・単位・出典は meta_url にある。URL の有効期限は約 24 時間。',
    inputSchema: z.object({
      stations: stationSelectorSchema
        .optional()
        .describe('対象駅のセレクタ（listStations と同じ）。grps と排他'),
      grps: z
        .array(z.string())
        .min(1)
        .max(DATASET_MAX_GRPS)
        .optional()
        .describe(`対象駅の grp 配列（最大 ${DATASET_MAX_GRPS}）。stations と排他`),
      metrics: z
        .array(z.string())
        .min(1)
        .describe(
          'カタログキーまたは指標ファミリの配列。例 ["pax", "pop", "pop_gr", "lp_med", "rate_covid"]',
        ),
      radiusM: z
        .number()
        .optional()
        .describe('ファミリ解決に使う集約半径(m): 500/1000/2000/5000/10000/20000。省略時 1000'),
      years: z
        .union([z.literal('latest'), z.array(z.number().int())])
        .optional()
        .describe(
          'ファミリ解決に使う年。省略・"latest" は直近（増減率は直近 5 年ペア）。配列なら各年の列を作る（例 [2015, 2020]）',
        ),
      shape: z
        .enum(['wide', 'long'])
        .optional()
        .describe('wide=1 駅 1 行×指標列（既定）/ long=grp,key,value の縦持ち'),
      includeHazard: z
        .boolean()
        .optional()
        .describe('true で駅別ハザードサマリ（事前計算・hazard_ 列）を結合'),
    }),
    errorFallbackJa: 'データセットの生成に失敗しました',
    run: async (
      { stations: selector, grps, metrics, radiusM, years, shape, includeHazard },
      ctx,
    ): Promise<
      ToolRunResult<
        HintErrorJa | ReturnType<typeof columnsError> | ReturnType<typeof buildDatasetForLlm>
      >
    > => {
      if ((selector === undefined) === (grps === undefined)) {
        return pure({
          error: '対象の指定が不正です',
          hint: 'stations（セレクタ）か grps（駅 ID の配列）のどちらか一方だけを指定してください。',
        })
      }
      const resolvedColumns = resolveDatasetColumns(metrics, radiusM, years)
      if (!resolvedColumns.ok) return pure(columnsError(resolvedColumns))
      const resolvedShape: DatasetShape = shape ?? 'wide'
      const allKeys = [...resolvedColumns.valueKeys, ...resolvedColumns.flagKeys]
      const extraNotes: string[] = []
      let listed: StationListItem[]
      let truncated = false
      let tokenQuery: DatasetQuery
      if (grps !== undefined) {
        const unique = [...new Set(nonEmptyNames(grps))]
        if (unique.length === 0) {
          return pure({
            error: '対象駅が指定されていません',
            hint: 'grps に listStations / searchStations が返した grp を入れてください。',
          })
        }
        listed = await listStations({ grps: unique, limit: LIST_MAX_LIMIT })
        if (listed.length === 0) {
          return pure({
            error: '指定した grp の駅が見つかりません',
            hint: 'searchStations / listStations で grp を取り直してください。',
          })
        }
        const found = new Set(listed.map((station) => station.grp))
        const missing = unique.filter((grp) => !found.has(grp))
        if (missing.length > 0) {
          extraNotes.push(
            `見つからない grp を ${missing.length} 件除外: ${missing.slice(0, 5).join('・')}${missing.length > 5 ? ' …' : ''}`,
          )
        }
        tokenQuery = {
          grps: listed.map((station) => station.grp),
          keys: allKeys,
          shape: resolvedShape,
        }
      } else {
        const resolvedSelector = selectorToFilter(selector ?? {}, DATASET_DEFAULT_STATION_LIMIT)
        if (!resolvedSelector.ok) return pure(resolvedSelector.error)
        listed = await listStations(resolvedSelector.filter)
        if (listed.length === 0) {
          return pure({
            error: '条件に合う駅が 0 件でした',
            hint: '市区町村の綴りや路線名を確認してください。路線名は会社名を含まない形（例「東横線」「東海道新幹線」）。0 件が続くときは operators（会社の正式名称）だけで全駅を取得してください。',
          })
        }
        truncated = listed.length >= resolvedSelector.requested
        tokenQuery = {
          selector: tokenSelectorOf(resolvedSelector.filter, resolvedSelector.requested),
          keys: allKeys,
          shape: resolvedShape,
        }
      }
      const values = await datasetRows(
        listed.map((station) => station.grp),
        allKeys,
      )
      const hazard = includeHazard === true ? await hazardJoinFor(listed) : null
      const merged = hazard === null ? values : withHazardValues(values, hazard)
      const signed = signDatasetToken(
        { ...tokenQuery, ...(includeHazard === true ? { hazard: true } : {}) },
        { secret: datasetSecret(), now: Date.now() },
      )
      const url = `${ctx.origin}/api/dataset?t=${signed.token}`
      return pure(
        buildDatasetForLlm({
          stations: listed,
          values: merged,
          resolved: resolvedColumns,
          hazard,
          shape: resolvedShape,
          urls: { url, metaUrl: `${url}&kind=meta`, expiresAtMs: signed.expiresAtMs },
          truncated,
          extraNotes,
        }),
      )
    },
  }),

  /** 駅別ハザードの一括取得（事前計算から読む・§5.3 ③）。 */
  getHazardSummary: defineSpec({
    name: 'getHazardSummary',
    description:
      '多数の駅（grps・最大 500）の水害・土砂災害リスクの要約を、事前計算テーブルから一括で返す。' +
      '「浸水リスクの低い駅に絞りたい」のような対象集合のスクリーニングに使う（1 駅ずつ getHazardAtPoint を繰り返さない）。' +
      '返るのは静的な想定（想定最大規模の「もし起きたら」）の順序尺度レベル（none<caution<warning<danger<critical）で、いまの警報ではない。' +
      'none は「区域図の上で該当なし」で、uncovered=true の駅は区域図が無い（安全とは言えない）。' +
      'レベルは足し算・平均ができない——合成するなら足切りか段階減点にし、「安全」とは書かない。' +
      '河川別の実測浸水深・到達時間は含まない（個別の駅は getHazardAtPoint で確認）。',
    inputSchema: z.object({
      grps: z
        .array(z.string())
        .min(1)
        .max(HAZARD_SUMMARY_MAX_GRPS)
        .describe(
          `駅 grp の配列（最大 ${HAZARD_SUMMARY_MAX_GRPS}・listStations / searchStations で得る）`,
        ),
    }),
    errorFallbackJa: 'ハザードサマリの取得に失敗しました',
    run: async ({
      grps,
    }): Promise<ToolRunResult<HintErrorJa | ReturnType<typeof hazardSummaryBulkForLlm>>> => {
      const unique = [...new Set(nonEmptyNames(grps))]
      if (unique.length === 0) {
        return pure({
          error: '駅が指定されていません',
          hint: 'grps に listStations / searchStations が返した grp を入れてください。',
        })
      }
      const rows = await stationHazardSummaries(unique)
      if (rows.length === 0) {
        return pure({
          error: '事前計算データが見つかりません',
          hint: 'grp を searchStations / listStations で取り直してください。個別の駅は getHazardAtPoint でも確認できます。',
        })
      }
      return pure(hazardSummaryBulkForLlm(unique, rows))
    },
  }),

  /** 駅の詳細（焦点カテゴリのチャート）を表示。grp は searchStations で得る。 */
  getStationDetail: defineSpec({
    name: 'getStationDetail',
    description:
      '駅（grp）の詳細を地図とチャートで表示する。category で焦点タブ（人口/地価/バス/事業所/従業者/乗降）を、radiusM で集約半径を指定。数値の要約を返す。',
    inputSchema: z.object({
      grp: z.string().describe('searchStations が返した駅 grp'),
      category: categorySchema.optional().describe('焦点カテゴリ。省略時は乗降客の概要'),
      radiusM: z
        .number()
        .optional()
        .describe('集約半径(m): 500/1000/2000/5000/10000/20000。省略時 1000'),
    }),
    errorFallbackJa: '駅詳細の取得に失敗しました',
    run: async ({
      grp,
      category,
      radiusM,
    }): Promise<ToolRunResult<{ error: string } | ReturnType<typeof stationDetailForLlm>>> => {
      const station = await stationByGrp(grp)
      if (station === null) return pure({ error: `駅が見つかりません: ${grp}` })
      const values = await stationBundle(grp)
      const detail = buildStationDetail(station, values)
      const resolved = resolveRadius(radiusM)
      const effect = {
        kind: 'stationDetail' as const,
        detail,
        category: category ?? null,
        radiusM: resolved,
      }
      return {
        effects: [effect],
        forLlm: stationDetailForLlm(station, resolved, category, effect),
      }
    },
  }),

  /** 都道府県×指標のランキング（上位/下位）。指標はキーでもファミリ名でもよい。 */
  rankStations: defineSpec({
    name: 'rankStations',
    description:
      '指標で駅を並べ替え上位/下位を返す。metric はカタログキー（pop_gr_2020_2015_1km）でも指標ファミリ（pop_gr）でもよく、ファミリなら radiusM / year で確定する（未指定は 1km・直近5年）。prefectures 未指定は全国、operators 未指定は全社、routes/routeTypes 未指定は全路線。',
    inputSchema: z.object({
      metric: z
        .string()
        .describe('カタログキー（例 pop_gr_2020_2015_1km）または指標ファミリ（例 pop_gr, lp_gr）'),
      radiusM: z
        .number()
        .optional()
        .describe(
          '集約半径(m): 500/1000/2000/5000/10000/20000。省略時 1000。半径非依存の指標では無視',
        ),
      year: z.number().optional().describe('対象年（増減率では新しい方の年）。省略時は直近'),
      yearBase: z.number().optional().describe('増減率の基準年（古い方の年）'),
      prefectures: z
        .array(z.string())
        .optional()
        .describe('都道府県名の配列。例: ["神奈川県"]。省略で全国'),
      operators: z
        .array(z.string())
        .optional()
        .describe(
          '運営会社名の配列（正式名称・例 ["東日本旅客鉄道"]。JR東日本ではない）。どれか1社でも運営する駅が対象。省略で全社',
        ),
      routes: z
        .array(z.string())
        .optional()
        .describe('路線名の配列（例 ["東海道新幹線"]）。省略で全路線'),
      routeTypes: z
        .array(z.number().int())
        .optional()
        .describe(
          `事業者種別の配列（${ROUTE_TYPE_HINT}）。「新幹線の駅だけ」は [1]。routes とは OR。省略で全種別`,
        ),
      order: z.enum(['asc', 'desc']).optional().describe('desc=上位(既定)/asc=下位'),
      limit: z
        .number()
        .int()
        .optional()
        .describe(`件数(1-${MAX_RANK_LIMIT}・既定 ${DEFAULT_RANK_LIMIT})`),
      excludeLowN: z
        .boolean()
        .optional()
        .describe('信頼性の低い値(⚠：母数が小さい・極端値)の駅を除外'),
    }),
    errorFallbackJa: 'ランキングに失敗しました',
    run: async ({
      metric,
      radiusM,
      year,
      yearBase,
      prefectures,
      operators,
      routes,
      routeTypes,
      order,
      limit,
      excludeLowN,
    }): Promise<
      ToolRunResult<ReturnType<typeof metricError> | HintErrorJa | ReturnType<typeof rankingForLlm>>
    > => {
      const resolved = resolveMetricKey({ metric, radiusM, year, yearBase })
      if (!resolved.ok) return pure(metricError(resolved))
      const { names: prefs, unknown } = normalizePrefectures(prefectures ?? [])
      if (unknown.length > 0) return pure(unknownPrefectures(unknown))
      const dir = order ?? 'desc'
      const lim = Math.min(Math.max(limit ?? DEFAULT_RANK_LIMIT, 1), MAX_RANK_LIMIT)
      const exclude = excludeLowN ?? false
      const ops = nonEmptyNames(operators)
      const lines = nonEmptyNames(routes)
      const types = (routeTypes ?? []).filter((type) => ROUTE_TYPES.some((t) => t === type))
      const { rows, total } = await rankByColumn(
        resolved.key,
        prefs,
        dir,
        lim,
        0,
        exclude,
        ops,
        lines,
        types,
      )
      const response = buildRanking(resolved.key, prefs, dir, rows, total, 0, {
        operators: ops,
        routes: lines,
        routeTypes: types,
      })
      // 路線名の綴り違いや、会社と路線の食い違いは 0 件になるだけで区別がつかない。
      // LLM が「無い」と誤断定しないよう理由を添える（compareGrowth と同じ扱い）。
      const emptyNote =
        total === 0 && (lines.length > 0 || types.length > 0)
          ? '該当が 0 件でした。路線名は正式名称（例「東海道新幹線」）で指定し、会社と路線が同じ事業者のものか確認してください。'
          : null
      return {
        effects: [{ kind: 'ranking' as const, response }],
        forLlm: rankingForLlm(
          resolved.key,
          resolutionNote(resolved.note, emptyNote),
          dir,
          response,
        ),
      }
    },
  }),

  /** 2 指標の増減率散布＋クラスタ（決定的 k-means）。 */
  compareGrowth: defineSpec({
    name: 'compareGrowth',
    description:
      '2 つの指標(x,y)で駅を散布しクラスタ化する。x/y はカタログキーでも指標ファミリ（pop_gr, lp_gr, rate_covid …）でもよく、radiusM を添えれば半径依存の指標がそれで確定する（未指定は 1km・直近5年）。prefectures 未指定は全国、operators 未指定は全社、routes/routeTypes 未指定は全路線。',
    inputSchema: z.object({
      x: z
        .string()
        .describe('x 軸のカタログキーまたは指標ファミリ。例: pop_gr, pop_gr_2020_2015_2km'),
      y: z.string().describe('y 軸のカタログキーまたは指標ファミリ。例: rate_covid, lp_gr'),
      radiusM: z
        .number()
        .optional()
        .describe('集約半径(m): 500/1000/2000/5000/10000/20000。x/y の半径依存の指標に適用'),
      prefectures: z.array(z.string()).optional().describe('都道府県名の配列。省略で全国'),
      operators: z
        .array(z.string())
        .optional()
        .describe(
          '運営会社名の配列（正式名称・例 ["東日本旅客鉄道"]。JR東日本ではない）。どれか1社でも運営する駅が対象。省略で全社',
        ),
      routes: z
        .array(z.string())
        .optional()
        .describe('路線名の配列（例 ["東海道新幹線"]）。省略で全路線'),
      routeTypes: z
        .array(z.number().int())
        .optional()
        .describe(
          `事業者種別の配列（${ROUTE_TYPE_HINT}）。「新幹線の駅だけ」は [1]。routes とは OR。省略で全種別`,
        ),
      excludeLowN: z
        .boolean()
        .optional()
        .describe('信頼性の低い値(⚠：母数が小さい・極端値)の駅を除外'),
    }),
    errorFallbackJa: '散布の集計に失敗しました',
    run: async ({
      x,
      y,
      radiusM,
      prefectures,
      operators,
      routes,
      routeTypes,
      excludeLowN,
    }): Promise<
      ToolRunResult<ReturnType<typeof metricError> | HintErrorJa | ReturnType<typeof growthForLlm>>
    > => {
      const xResolved = resolveMetricKey({ metric: x, radiusM })
      if (!xResolved.ok) return pure(metricError(xResolved))
      const yResolved = resolveMetricKey({ metric: y, radiusM })
      if (!yResolved.ok) return pure(metricError(yResolved))
      const { names: prefs, unknown } = normalizePrefectures(prefectures ?? [])
      if (unknown.length > 0) return pure(unknownPrefectures(unknown))
      const exclude = excludeLowN ?? false
      // 信頼性フラグは除外するときだけ引く（引かなければ DB 側の集計も軽い）。
      const flags = exclude
        ? [
            requireEntry(xResolved.key).reliabilityFlagKey,
            requireEntry(yResolved.key).reliabilityFlagKey,
          ]
        : [null, null]
      const ops = nonEmptyNames(operators)
      const lines = nonEmptyNames(routes)
      const types = (routeTypes ?? []).filter((type) => ROUTE_TYPES.some((t) => t === type))
      const valueRows = await scatterPoints(
        xResolved.key,
        yResolved.key,
        flags[0] ?? null,
        flags[1] ?? null,
        { prefectures: prefs, operators: ops, routes: lines, routeTypes: types },
      )
      const response = buildGrowth(valueRows, xResolved.key, yResolved.key, {
        excludeLowN: exclude,
        prefectures: prefs,
        operators: ops,
        routes: lines,
        routeTypes: types,
      })
      // 路線名の綴り違いや、会社と路線の食い違い（例 東海旅客鉄道 × 東北新幹線）は
      // 0 件になるだけで区別がつかない。LLM が「無い」と誤断定しないよう理由を添える。
      const emptyNote =
        response.points.length === 0 && (lines.length > 0 || types.length > 0)
          ? '該当が 0 件でした。路線名は正式名称（例「東海道新幹線」）で指定し、会社と路線が同じ事業者のものか確認してください。'
          : null
      return {
        effects: [{ kind: 'growth' as const, response }],
        forLlm: growthForLlm(
          xResolved.key,
          yResolved.key,
          resolutionNote(xResolved.note, yResolved.note, emptyNote),
          response,
        ),
      }
    },
  }),

  /**
   * 地点（駅または緯度経度）の災害リスク。共通API（`/api/hazard/point`）と**同じ関数**を通る。
   * 意味づけ・危険度・避難の目安はすべてサーバが決めた文字列で、LLM は説明するだけでよい。
   */
  getHazardAtPoint: defineSpec({
    name: 'getHazardAtPoint',
    description:
      '地点の水害・土砂災害リスクを調べる。駅なら grp、任意地点なら lon/lat を渡す。' +
      '洪水（想定最大規模・計画規模）・浸水継続時間・家屋倒壊等氾濫想定区域・内水・高潮・津波・土砂災害の該当と、' +
      '立退き/垂直避難の目安、河川ごとの浸水深(m)・到達時間(分)・継続時間(分)を返す。' +
      '「ここは安全か」「大丈夫か」「浸水するか」「何m浸かるか」「何分後に浸水するか」「水害のリスクは」に必ずこれを使う。',
    inputSchema: z.object({
      grp: z
        .string()
        .optional()
        .describe('searchStations が返した駅 grp（駅について聞かれたとき）'),
      lon: z.number().optional().describe('経度（grp を使わないとき）'),
      lat: z.number().optional().describe('緯度（grp を使わないとき）'),
      placeJa: z.string().optional().describe('地点の呼び名。例: 亀有駅、現在地'),
    }),
    errorFallbackJa: '災害リスクの取得に失敗しました',
    run: async (
      { grp, lon, lat, placeJa },
      ctx,
    ): Promise<ToolRunResult<HintErrorJa | ReturnType<typeof hazardSummaryForLlm>>> => {
      const target = await resolveHazardTarget({ grp, lon, lat, placeJa })
      if ('error' in target) return pure(target)
      const { point } = await hazardPointAt({ ...target, baseUrl: ctx.origin, now: Date.now() })
      return {
        effects: [{ kind: 'hazardPoint' as const, point }],
        forLlm: hazardSummaryForLlm(point),
      }
    },
  }),

  /**
   * **いま**その地点に出ている警報・注意報（`/api/hazard/alerts` と同じ関数を通る）。
   * 平時の `getHazardAtPoint`（もし起きたら）とは**別のツール**。混ぜると誤読される。
   */
  getHazardAlerts: defineSpec({
    name: 'getHazardAlerts',
    description:
      'いまその地点に発表されている気象庁の警報・注意報と、警戒レベル相当を調べる。' +
      '駅なら grp、任意地点なら lon/lat を渡す。' +
      '「今どうなってる」「警報は出てる？」「大雨警報は？」「避難した方がいい？」に使う。' +
      '土砂災害の危険度・指定河川洪水予報（氾濫危険情報など）も含む。' +
      '⚠ 市町村が出す避難情報（避難指示など）は含まれない（返り値の limitationsJa を必ず伝えること）。',
    inputSchema: z.object({
      grp: z.string().optional().describe('searchStations が返した駅 grp'),
      lon: z.number().optional().describe('経度（grp を使わないとき）'),
      lat: z.number().optional().describe('緯度（grp を使わないとき）'),
      placeJa: z.string().optional().describe('地点の呼び名。例: 亀有駅、現在地'),
    }),
    errorFallbackJa: '警戒状況の取得に失敗しました',
    run: async ({
      grp,
      lon,
      lat,
      placeJa,
    }): Promise<ToolRunResult<HintErrorJa | ReturnType<typeof alertSummaryForLlm>>> => {
      const target = await resolveHazardTarget({ grp, lon, lat, placeJa })
      if ('error' in target) return pure(target)
      const alerts = await hazardAlertsAt({ ...target, now: Date.now() })
      return {
        effects: [{ kind: 'hazardAlerts' as const, alerts }],
        forLlm: alertSummaryForLlm(alerts),
      }
    },
  }),

  /**
   * **どこへ逃げるか**（`/api/hazard/evacuation` と同じ関数を通る）。
   *
   * `for`（災害種別）を**必須**にしてある。既定で洪水に倒すと、土砂災害を心配している人に
   * 洪水にしか対応していない避難場所を返しうる（§11 リスク 10 ＝人命）。
   */
  findEvacuationSites: defineSpec({
    name: 'findEvacuationSites',
    description:
      'その地点の近くにある「指定緊急避難場所」を、災害種別に対応したものだけ調べる。' +
      '駅なら grp、任意地点なら lon/lat を渡し、for に災害種別を必ず指定する。' +
      '「どこに逃げればいい」「避難場所は」「近くの避難所」に使う。' +
      '⚠ 返るのは市町村が指定した一覧で、**いま開設されているかは分からない**。' +
      '返り値の limitationsJa を必ず伝え、「ここへ避難してください」とは書かないこと。',
    inputSchema: z.object({
      grp: z.string().optional().describe('searchStations が返した駅 grp'),
      lon: z.number().optional().describe('経度（grp を使わないとき）'),
      lat: z.number().optional().describe('緯度（grp を使わないとき）'),
      placeJa: z.string().optional().describe('地点の呼び名。例: 亀有駅、現在地'),
      for: evacuationDisasterKeySchema.describe(
        `対応する災害種別（必須）。${EVACUATION_DISASTERS.map((d) => `${d.key}=${d.labelJa}`).join(' / ')}`,
      ),
      radiusM: z.number().optional().describe('探す半径（メートル・既定 5000・最大 20000）'),
    }),
    errorFallbackJa: '避難場所の取得に失敗しました',
    run: async (
      { grp, lon, lat, placeJa, for: disaster, radiusM },
      ctx,
    ): Promise<ToolRunResult<HintErrorJa | ReturnType<typeof evacuationSummaryForLlm>>> => {
      const target = await resolveHazardTarget({ grp, lon, lat, placeJa })
      if ('error' in target) return pure(target)
      const evacuation = await evacuationSitesAt({ ...target, disaster, radiusM }, ctx.origin)
      return {
        effects: [{ kind: 'evacuation' as const, evacuation }],
        forLlm: evacuationSummaryForLlm(evacuation),
      }
    },
  }),

  /**
   * **どちらへ動けば区域の外か**（`/api/hazard/escape` と同じ関数を通る）。
   *
   * 避難先の一覧（`findEvacuationSites`）とは**別の問い**である。あちらは点、こちらは向き。
   */
  findEscapeDirection: defineSpec({
    name: 'findEscapeDirection',
    description:
      'その地点から、いちばん近い「浸水想定区域の外」がどちらへ何 m かを調べる。' +
      '駅なら grp、任意地点なら lon/lat を渡し、for に災害種別を指定する（洪水・内水のみ）。' +
      '「どっちに逃げれば浸水域から出られる？」「区域の外はどこ？」に使う。' +
      '⚠ **経路案内ではない**。返るのは方向と直線距離だけで、道路の冠水は見ていない。' +
      '返り値の limitationsJa を必ず伝え、「そちらへ移動してください」とは書かないこと。',
    inputSchema: z.object({
      grp: z.string().optional().describe('searchStations が返した駅 grp'),
      lon: z.number().optional().describe('経度（grp を使わないとき）'),
      lat: z.number().optional().describe('緯度（grp を使わないとき）'),
      placeJa: z.string().optional().describe('地点の呼び名。例: 亀有駅、現在地'),
      for: evacuationDisasterKeySchema.describe(
        '対応する災害種別。**方向を出せるのは flood（洪水）と inland_flood（内水氾濫）だけ**',
      ),
    }),
    errorFallbackJa: '脱出方向の取得に失敗しました',
    run: async (
      { grp, lon, lat, placeJa, for: disaster },
      ctx,
    ): Promise<ToolRunResult<HintErrorJa | ReturnType<typeof escapeSummaryForLlm>>> => {
      const target = await resolveHazardTarget({ grp, lon, lat, placeJa })
      if ('error' in target) return pure(target)
      const escape = await escapeDirectionAt({ ...target, disaster }, ctx.origin)
      return {
        effects: [{ kind: 'escape' as const, escape }],
        forLlm: escapeSummaryForLlm(escape),
      }
    },
  }),

  /** 利用可能な指標カタログの照会（正確なキーの発見）。 */
  getMetricsCatalog: defineSpec({
    name: 'getMetricsCatalog',
    description:
      '利用可能な指標カタログを照会する。category や baseMetric で絞り込み、rankStations/compareGrowth に渡す正確なキーを得る。',
    inputSchema: z.object({
      category: categorySchema.optional().describe('カテゴリで絞り込み'),
      baseMetric: z
        .string()
        .optional()
        .describe('指標ファミリで絞り込み。例: pop_gr, lp_med, bus_n'),
    }),
    // 純粋な照会（カタログはビルド時に確定）。捕捉せず、投げたらそのまま上へ。
    errorFallbackJa: null,
    run: async ({ category, baseMetric }) => pure(metricsCatalogDigest({ category, baseMetric })),
  }),
} as const

/** ツール名（登録順）。テスト・MCP 側の網羅チェックに使う（キーの増減は satisfies が捕まえる）。 */
export const TOOL_SPEC_NAMES = [
  'searchStations',
  'listStations',
  'buildDataset',
  'getHazardSummary',
  'getStationDetail',
  'rankStations',
  'compareGrowth',
  'getHazardAtPoint',
  'getHazardAlerts',
  'findEvacuationSites',
  'findEscapeDirection',
  'getMetricsCatalog',
] as const satisfies readonly (keyof typeof TOOL_SPECS)[]
