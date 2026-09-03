/**
 * MCP アダプタ（`docs/260828_research_claude_auth.md` §4.2 PR-2・サーバ専用）。
 *
 * `tool-specs.ts` の **ToolSpec（単一の真実）** を MCP の `registerTool` に写す。
 * Gemini 側（`tools.ts`）と同じ `run` を呼ぶので、**同じ質問に別の答えを出さない**。
 *
 * ここが持つのは「MCP にだけ要る意味づけ」：
 * - **名前の写像**（camelCase → snake_case・ASCII・64 文字以内。Claude のツール名制約）
 * - `title`＋`readOnlyHint`（全ツール読み取り専用。Claude が確認なしで実行する条件・審査基準）
 * - 説明の**日英併記**（本文は Spec の日本語をそのまま・英語は 1 文だけ足す）
 * - `_meta["anthropic/maxResultSizeChars"]`（Claude 側の結果退避の上限を明示）
 * - **ツール別レート制限**（上流：気象庁・国土地理院を叩くものは厳しく・§4.4）
 * - `structuredContent`＝GUI Chat Protocol（パネル＋地図操作）。text は Gemini と同じ要約 JSON
 *
 * 登録は `tools.ts` と同じ流儀で**ツールごとに具象のまま**ヘルパをツール数ぶん呼ぶ——
 * ユニオンでループすると `run` の入力型が交差型に潰れて呼べなくなるため。
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { type CallToolResult, type ReadResourceResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  MAP_PANEL_APP_URI,
  MAP_PROBE_URI,
  MAP_TILE_ORIGIN,
  MCP_APP_MIME_TYPE,
  PANEL_APP_URI,
} from './mcp-app/meta'
import { PANEL_APP_HTML } from './mcp-app/panel-app'
import { MAP_CONNECT_ORIGINS, MAP_PANEL_APP_HTML } from './mcp-app/map-panel-app'
import { MAP_PROBE_HTML } from './mcp-app/map-probe'
import { type MapAction, type Panel } from '@/shared/protocol'
import { checkRateLimit } from './rate-limit'
import {
  panelsForEscape,
  panelsForEvacuation,
  panelsForGrowth,
  panelsForHazardAlerts,
  panelsForHazardPoint,
  panelsForRanking,
  panelsForStationDetail,
  mapActionsForEffect,
} from './assemble'
import { metricsCatalogDigest } from './catalog-digest'
import { TOOL_SPECS, type TOOL_SPEC_NAMES, type ToolSpec } from './tool-specs'
import { type ToolEffect } from './types'

/**
 * リクエスト元 IP を run 中のツールへ運ぶ（ツール別レート制限の鍵）。
 * ルート（`app/api/mcp/route.ts`）が `run(ip, …)` で包む。ALS が無い文脈（テスト等）は 'unknown'。
 */
export const mcpIpStore = new AsyncLocalStorage<string>()

/** ツール別レート制限の窓（1 分・固定窓）。 */
const TOOL_WINDOW_MS = 60_000

type SpecKey = (typeof TOOL_SPEC_NAMES)[number]

/** MCP のツール実行結果（SDK の型そのまま＝`McpServer` と互換）。 */
export type McpToolResult = CallToolResult

/**
 * 登録先の最小の面。実体は `@modelcontextprotocol/server` の `McpServer` で、
 * この構造を満たす（テストは同じ型の偽サーバで受ける＝キャスト不要）。
 * 結果型を SDK のもの（`CallToolResult` / `ReadResourceResult`）にしてあるのは、
 * 自前の形だと `McpServer` → この型への代入互換が崩れるため。
 */
export type McpToolRegistry = {
  registerTool(
    name: string,
    config: {
      title: string
      description: string
      inputSchema: z.ZodTypeAny
      annotations: { readOnlyHint: boolean }
      _meta: Record<string, unknown>
    },
    callback: (input: unknown) => Promise<McpToolResult>,
  ): unknown
  registerResource(
    name: string,
    uri: string,
    config: { title: string; description: string; mimeType: string },
    callback: (uri: URL) => Promise<ReadResourceResult>,
  ): unknown
}

/** MCP にだけ要るツールごとの意味づけ。キーは ToolSpec と同じ。 */
export type McpToolConfig = {
  /** MCP のツール名（snake_case・ASCII・64 文字以内）。 */
  readonly mcpName: string
  /** 一覧に出る短い題（日本語）。 */
  readonly titleJa: string
  /** 説明に併記する英語 1 文（本文は Spec の日本語のまま）。 */
  readonly descriptionEn: string
  /** Claude 側の結果退避の上限（文字）。 */
  readonly maxResultSizeChars: number
  /** 1 分あたりの上限（IP×ツール）。上流を叩くものは厳しく。 */
  readonly perMinute: number
  /**
   * パネル（GUI Chat Protocol）を返すツールに MCP Apps のビューアを付ける（PR-9）。
   * 対応ホスト（Claude.ai / Desktop）だけが描画し、Claude Code はテキストにフォールバック。
   */
  readonly panelUi?: boolean
  /**
   * mapActions が**座標（またはレイヤ）を持つ**ツールは、MapLibre 同梱の地図つきビューアを
   * 参照する（PR-9b）。ランキング等（grp のみで座標なし）は軽量版のまま——約 1.1MB の
   * HTML を、地図に描くものが無いツールに配らない。
   */
  readonly mapUi?: boolean
}

export const MCP_TOOL_CONFIGS: Readonly<Record<SpecKey, McpToolConfig>> = {
  searchStations: {
    mcpName: 'search_stations',
    titleJa: '駅名検索',
    descriptionEn: 'Search Japanese railway stations by name and get their grp ids.',
    maxResultSizeChars: 20_000,
    perMinute: 30,
  },
  listStations: {
    mcpName: 'list_stations',
    titleJa: '駅の一覧（対象集合）',
    descriptionEn:
      'List stations by prefecture / municipality (prefix match; 横浜市 bundles its wards), operator, route, bbox or near. Returns ids and coordinates only.',
    maxResultSizeChars: 40_000,
    perMinute: 30,
  },
  buildDataset: {
    mcpName: 'build_dataset',
    titleJa: 'データセット生成（駅×指標の CSV）',
    descriptionEn:
      'Build a stations × metrics CSV in one call. Returns short-lived URLs (csv + meta) with schema, preview and caveats only — analyse locally with pandas.',
    maxResultSizeChars: 25_000,
    // CSV 生成は 1 回で重いクエリ＋短命 URL の発行なので、検索系より絞る（§4.4）。
    perMinute: 10,
  },
  getHazardSummary: {
    mcpName: 'get_hazard_summary',
    titleJa: '駅別ハザード一括（事前計算）',
    descriptionEn:
      'Precomputed static hazard summaries (ordinal levels, assumed-maximum scenarios) for up to 500 stations in one call. Not current alerts.',
    maxResultSizeChars: 80_000,
    perMinute: 20,
  },
  getStationDetail: {
    mcpName: 'get_station_detail',
    titleJa: '駅の詳細',
    descriptionEn:
      'Aggregated open-data metrics (ridership, population, land price, …) around one station for a chosen radius.',
    maxResultSizeChars: 60_000,
    perMinute: 30,
    panelUi: true,
    mapUi: true, // flyTo＋selectStation（半径円）
  },
  rankStations: {
    mcpName: 'rank_stations',
    titleJa: '駅ランキング',
    descriptionEn: 'Rank stations by a catalog metric, filtered by prefecture/operator/route.',
    maxResultSizeChars: 60_000,
    perMinute: 30,
    panelUi: true,
  },
  compareGrowth: {
    mcpName: 'compare_growth',
    titleJa: '2 指標の散布',
    descriptionEn: 'Scatter stations on two metrics with deterministic clustering.',
    maxResultSizeChars: 60_000,
    perMinute: 30,
    panelUi: true,
  },
  getHazardAtPoint: {
    mcpName: 'get_hazard_at_point',
    titleJa: '地点の災害リスク',
    descriptionEn:
      'Static flood/landslide/storm-surge/tsunami exposure at a station or coordinate (assumed maximum scale).',
    // 公式タイル・浸水ナビ（上流）を読む → やや厳しめ。
    maxResultSizeChars: 60_000,
    perMinute: 15,
    panelUi: true,
    mapUi: true, // showPoint＋setHazardLayers（当たった区域の面）
  },
  getHazardAlerts: {
    mcpName: 'get_hazard_alerts',
    titleJa: 'いまの警報・注意報',
    descriptionEn: 'Current JMA warnings/advisories and alert-level equivalents for a point.',
    // 気象庁・逆ジオ（上流）を毎回叩く → いちばん厳しく。
    maxResultSizeChars: 40_000,
    perMinute: 10,
    panelUi: true,
    mapUi: true, // showPoint＋setHazardLayers（キキクル・警戒モード）
  },
  findEvacuationSites: {
    mcpName: 'find_evacuation_sites',
    titleJa: '指定緊急避難場所',
    descriptionEn:
      'Designated emergency evacuation sites near a point, filtered by the disaster type they cover.',
    // 国土地理院タイル（上流）→ 厳しめ。
    maxResultSizeChars: 60_000,
    perMinute: 10,
    panelUi: true,
    mapUi: true, // showPoint＋highlightPoints（起点と行き先の印）
  },
  findEscapeDirection: {
    mcpName: 'find_escape_direction',
    titleJa: '区域の外へ出る向き',
    descriptionEn:
      'Nearest direction/distance out of the assumed flood zone (flood / inland flood only). Not routing.',
    maxResultSizeChars: 40_000,
    perMinute: 10,
    panelUi: true,
    mapUi: true, // showPoint＋highlightPoints（区域の外に出る目標セル）
  },
  getMetricsCatalog: {
    mcpName: 'get_metrics_catalog',
    titleJa: 'メトリクス・カタログ',
    descriptionEn: 'Self-describing metrics catalog: exact keys, labels, units, radii, years.',
    maxResultSizeChars: 60_000,
    perMinute: 60,
  },
}

/** MCP に出す説明（本文＝Spec の日本語そのまま・英語 1 文を併記）。 */
export function mcpDescription(specKey: SpecKey): string {
  return `${TOOL_SPECS[specKey].description}\nEN: ${MCP_TOOL_CONFIGS[specKey].descriptionEn}`
}

/** 副産物 → GUI Chat Protocol のパネル（`assemble.ts` の既存ビルダを 1 か所で束ねる）。 */
function panelsForEffect(effect: ToolEffect): Panel[] {
  switch (effect.kind) {
    case 'stationDetail':
      return panelsForStationDetail(effect)
    case 'ranking':
      return panelsForRanking(effect)
    case 'growth':
      return panelsForGrowth(effect)
    case 'hazardPoint':
      return panelsForHazardPoint(effect)
    case 'hazardAlerts':
      return panelsForHazardAlerts(effect)
    case 'evacuation':
      return panelsForEvacuation(effect)
    case 'escape':
      return panelsForEscape(effect)
  }
}

/** 副産物列 → structuredContent（パネル＋地図操作）。UI・Gemini と同じ protocol 型。 */
export function structuredContentFor(effects: readonly ToolEffect[]): {
  panels: Panel[]
  mapActions: MapAction[]
} {
  return {
    panels: effects.flatMap(panelsForEffect),
    mapActions: effects.flatMap(mapActionsForEffect),
  }
}

/** レート制限に当たったときの言い方（次に何をすべきかまで言う・日英）。 */
function rateLimitedJa(mcpName: string, retryAfterMs: number): string {
  const seconds = Math.ceil(retryAfterMs / 1000)
  return (
    `このツール（${mcpName}）の呼び出しが多すぎます。約 ${seconds} 秒待ってから再試行してください。` +
    `外部データ（気象庁・国土地理院）を守るための制限です。 / ` +
    `EN: Rate limited for ${mcpName}. Retry after ~${seconds}s.`
  )
}

/** テストから上限を差し替えるための注入口（既定は `MCP_TOOL_CONFIGS.perMinute`）。 */
export type McpRegisterOptions = {
  readonly perMinuteOverrides?: Partial<Record<SpecKey, number>>
  readonly now?: () => number
}

/**
 * 1 本の Spec を MCP ツールとして登録する（具象のまま＝型が崩れない）。
 *
 * 入力は SDK が検証するが、cb には unknown で届くので **Spec と同一の Zod で parse し直す**
 * （キャストではなく検証で型を得る）。text＝Gemini と同じ要約 JSON、structuredContent＝
 * protocol のパネル＋地図操作。例外は Spec の `errorFallbackJa`（null は捕捉しない）で
 * `isError: true` として返す——ホストの LLM が謝って言い直せる形。
 */
function registerSpec<Schema extends z.ZodTypeAny, Out>(
  server: McpToolRegistry,
  key: SpecKey,
  spec: ToolSpec<Schema, Out>,
  origin: string,
  options: McpRegisterOptions,
): void {
  const config = MCP_TOOL_CONFIGS[key]
  const perMinute = options.perMinuteOverrides?.[key] ?? config.perMinute
  const now = options.now ?? Date.now
  server.registerTool(
    config.mcpName,
    {
      title: config.titleJa,
      description: mcpDescription(key),
      inputSchema: spec.inputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        'anthropic/maxResultSizeChars': config.maxResultSizeChars,
        // MCP Apps（ext-apps 2026-01-26）：対応ホストはこの ui:// リソースを iframe に描く。
        // 座標つきの mapActions を返すツールは地図つき版（PR-9b）、それ以外は軽量版。
        ...(config.panelUi === true || config.mapUi === true
          ? { ui: { resourceUri: config.mapUi === true ? MAP_PANEL_APP_URI : PANEL_APP_URI } }
          : {}),
      },
    },
    async (input) => {
      const ip = mcpIpStore.getStore() ?? 'unknown'
      const limited = checkRateLimit(`mcp:${ip}:${config.mcpName}`, {
        limit: perMinute,
        windowMs: TOOL_WINDOW_MS,
        now: now(),
      })
      if (!limited.ok) {
        return {
          content: [{ type: 'text', text: rateLimitedJa(config.mcpName, limited.retryAfterMs) }],
          isError: true,
        }
      }
      try {
        const parsed = spec.inputSchema.parse(input)
        const { effects, forLlm } = await spec.run(parsed, { origin })
        // ⚠ result を structuredContent にも入れる（260903・PR-7 の実走 eval で発見）。
        // Claude Code の MCP クライアントは structuredContent があると content の text を
        // モデルに見せない。パネルだけを入れていた頃は、パネルなしツール（list/build/一括）が
        // **空の {"panels":[],"mapActions":[]} に見えて**いた——どのクライアントでも
        // 同じ答えになるよう、LLM 向け要約を両方に載せる。
        return {
          content: [{ type: 'text', text: JSON.stringify(forLlm) }],
          structuredContent: { result: forLlm, ...structuredContentFor(effects) },
        }
      } catch (error) {
        if (spec.errorFallbackJa === null) throw error
        const message = error instanceof Error ? error.message : spec.errorFallbackJa
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          isError: true,
        }
      }
    },
  )
}

/**
 * 全ツール（`TOOL_SPEC_NAMES` の順）＋カタログ resource を登録する。
 * `tools.ts` の `createTools` と同じく**キーを列挙**する（ユニオンでループしない）。
 * ⚠ `buildDataset` は Gemini（`tools.ts`）には出さない（§5.6）が、MCP には出す——
 * Claude Code / Cowork にはコード実行環境があり、CSV をローカルで分析できるため。
 */
export function registerMcpTools(
  server: McpToolRegistry,
  origin: string,
  options: McpRegisterOptions = {},
): void {
  const s = TOOL_SPECS
  registerSpec(server, 'searchStations', s.searchStations, origin, options)
  registerSpec(server, 'listStations', s.listStations, origin, options)
  registerSpec(server, 'buildDataset', s.buildDataset, origin, options)
  registerSpec(server, 'getHazardSummary', s.getHazardSummary, origin, options)
  registerSpec(server, 'getStationDetail', s.getStationDetail, origin, options)
  registerSpec(server, 'rankStations', s.rankStations, origin, options)
  registerSpec(server, 'compareGrowth', s.compareGrowth, origin, options)
  registerSpec(server, 'getHazardAtPoint', s.getHazardAtPoint, origin, options)
  registerSpec(server, 'getHazardAlerts', s.getHazardAlerts, origin, options)
  registerSpec(server, 'findEvacuationSites', s.findEvacuationSites, origin, options)
  registerSpec(server, 'findEscapeDirection', s.findEscapeDirection, origin, options)
  registerSpec(server, 'getMetricsCatalog', s.getMetricsCatalog, origin, options)

  // カタログは resource としても出す（`@station-data:catalog://metrics` で添付できる）。
  server.registerResource(
    'metrics-catalog',
    'catalog://metrics',
    {
      title: 'メトリクス・カタログ / Metrics catalog',
      description:
        '利用可能な指標のカタログ（キー・ラベル・単位・半径・年次）。ランキング・散布に渡す正確なキーの単一の真実。',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(metricsCatalogDigest({})),
        },
      ],
    }),
  )

  // --- MCP Apps（PR-9 スパイク・§4.6） -----------------------------------
  // パネル・ビューア：panelUi のツール結果（structuredContent.panels）を描く単一 HTML。
  // 外部接続ゼロ（既定 CSP のまま）。Claude Code など非対応ホストはテキストへフォールバック。
  server.registerResource(
    'panel-app',
    PANEL_APP_URI,
    {
      title: 'パネル・ビューア（MCP Apps）',
      description:
        'ツール結果のパネル（GUI Chat Protocol）をチャート・表として描く。/ EN: Renders panels from tool results.',
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text: PANEL_APP_HTML }],
    }),
  )
  // 地図つきパネル・ビューア（PR-9b）：MapLibre 同梱。タイル（地理院・ハザードマップポータル・
  // 気象庁）を実行時に取るため、接続先を CSP（connectDomains）に宣言する——
  // 宣言リストは**ハザード・カタログから算出**（手書きしない・レイヤ追加に自動追随）。
  server.registerResource(
    'map-panel-app',
    MAP_PANEL_APP_URI,
    {
      title: '地図つきパネル・ビューア（MCP Apps）',
      description:
        'ツール結果のパネルに加えて、地図操作（地点・半径円・避難先・ハザードの面）を MapLibre で描く。/ EN: Renders panels plus map actions with MapLibre.',
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: MCP_APP_MIME_TYPE,
          text: MAP_PANEL_APP_HTML,
          _meta: { ui: { csp: { connectDomains: [...MAP_CONNECT_ORIGINS] } } },
        },
      ],
    }),
  )
  // MapLibre 可否プローブ：blob Worker・WebGL・タイル接続を実測する（判定は画面の表）。
  // 接続検査のため、地理院タイルのホストだけを CSP（connectDomains）に宣言する。
  server.registerResource(
    'map-probe',
    MAP_PROBE_URI,
    {
      title: 'MapLibre 可否プローブ（MCP Apps）',
      description:
        '地図描画に必要な iframe 能力（blob: Worker・WebGL・タイル接続）を実測する。/ EN: Probes iframe capabilities for MapLibre.',
      mimeType: MCP_APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: MCP_APP_MIME_TYPE,
          text: MAP_PROBE_HTML,
          _meta: { ui: { csp: { connectDomains: [MAP_TILE_ORIGIN] } } },
        },
      ],
    }),
  )
  // プローブの入口ツール（ホストは tool 呼び出し経由でしか app を描かないため）。
  // ToolSpec には載せない——Gemini・スキルの対象外で、対応ホストでだけ意味を持つデバッグ用途。
  server.registerTool(
    'map_probe',
    {
      title: '地図描画の可否プローブ（MCP Apps）',
      description:
        'MCP Apps 対応ホストで、地図（MapLibre）描画に必要な条件（blob: Web Worker・WebGL・タイルホスト接続）を実測して表に出す。非対応ホストではこのテキストだけが返る。\nEN: Probes iframe capabilities required for MapLibre inside MCP Apps hosts.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
      _meta: { 'anthropic/maxResultSizeChars': 2_000, ui: { resourceUri: MAP_PROBE_URI } },
    },
    async () => {
      const ip = mcpIpStore.getStore() ?? 'unknown'
      const now = options.now ?? Date.now
      const limited = checkRateLimit(`mcp:${ip}:map_probe`, {
        limit: 10,
        windowMs: TOOL_WINDOW_MS,
        now: now(),
      })
      if (!limited.ok) {
        return {
          content: [{ type: 'text', text: rateLimitedJa('map_probe', limited.retryAfterMs) }],
          isError: true,
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: 'MapLibre 可否プローブの UI を表示しました。結果は画面の表を読んでください（MCP Apps 非対応のホストでは検査できません）。',
          },
        ],
        structuredContent: { result: { shown: true }, panels: [], mapActions: [] },
      }
    },
  )
}
