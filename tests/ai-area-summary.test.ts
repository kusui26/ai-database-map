/**
 * AI の道具 `getAreaSummary`（MCP は `get_area_summary`・2026-10-11 B5d・`docs/261001_fix_user_feedback_ui.md` §6.12.9）。
 *
 * DB と名前の索引だけを差し替え、共通 API（`/api/areas/summary`）と同じ組み立て（`loadAreaSummary`）を通す。
 *
 * 見ること：
 * - LLM へ返すのは**サーバが書いた文**（区域の値と年と増減・作り方・内訳の上位と下位・駅の周りは「エリア全体の値ではない」・
 *   色の意味・答え方 answerGuide）。値を作らせない
 * - パネルは要約・推移・内訳（会話の中）、地図はエリアの駅の色分け（`colorStations`）。⤢ はまだ無い（B5e）
 * - 比較は 1 回で 2 つ（比べる表と指数の推移・内訳は出さない）。色分けしない（none）なら地図の操作を送らない
 * - 色分けの指標はファミリ名で受け、半径つきのキーに決める。知らない指標・決まらない名前は理由を返し、集計しない
 * - MCP：15 本目として登録・`present:"echarts"` で推移と内訳の図・地図の範囲（inMapView）は SDK の検めで外れるので空のエリアとして理由
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { type StationFilter, type StationMetricValue } from '@/db/queries'
import { buildAdminIndex } from '@/ai/area-summary/admin-index'
import { AREA_SUMMARY_ANSWER_GUIDE_JA, areaSummaryForLlm } from '@/ai/area-summary/for-llm'
import { type SummaryAreasDeps } from '@/ai/area-summary/resolve'
import { buildAreaIndex } from '@/ai/area/place-index'
import { assemble, mapActionsForEffect, panelsForAreaSummary, promotionsFor } from '@/ai/assemble'
import {
  MCP_TOOL_CONFIGS,
  registerMcpTools,
  type McpToolRegistry,
  type McpToolResult,
} from '@/ai/mcp-tools'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { TOOL_SPECS, type ToolRunContext } from '@/ai/tool-specs'
import { type AreaSummaryEffect, type ToolEffect } from '@/ai/types'
import { mapResponseSchema } from '@/shared/protocol'
import { type Viewport } from '@/shared/viewport'
import { NAME_ROWS, NAME_STATIONS, YOKOHAMA_VIEW } from './fixtures/area-names'
import {
  KAWASAKI_POP_GR,
  KAWASAKI_ROWS,
  TOYOKO_ROWS,
  YOKOHAMA_LP_MED,
  YOKOHAMA_POP_GR,
  YOKOHAMA_ROWS,
  YOKOHAMA_STATION_STATS,
} from './fixtures/area-summary'

const db = vi.hoisted(() => ({
  areaRows: vi.fn(),
  areaStationStats: vi.fn(),
  stationMetricValues: vi.fn(),
  lineStationsInOrder: vi.fn(),
  datasetRows: vi.fn(),
  stationByGrp: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const names = vi.hoisted(() => ({ summaryAreasDeps: vi.fn() }))
vi.mock('@/ai/area-summary/deps', () => names)

const ALL_ROWS = [...YOKOHAMA_ROWS, ...KAWASAKI_ROWS, ...TOYOKO_ROWS]
const CTX: ToolRunContext = { origin: 'http://localhost:3000' }

const NAME_DEPS: SummaryAreasDeps = {
  adminIndex: async () => buildAdminIndex(NAME_ROWS, NAME_STATIONS),
  stationIndex: async () => buildAreaIndex(NAME_STATIONS),
  resolveLines: async () => ({ ok: true, filters: { operators: [], lines: [] }, notes: [] }),
}

/** 知っている区域の行（内訳の子は鍵の子だけ・`area_rows` と同じ返し方）。 */
function rowsFor(keys: readonly string[], withChildren: boolean) {
  return ALL_ROWS.filter(
    (row) =>
      keys.includes(row.key) ||
      (withChildren && row.parentKey !== null && keys.includes(row.parentKey)),
  )
}

/** 指標と絞り込み → その駅の値（横浜市・川崎市・地価）。 */
function valuesFor(key: string, filter: StationFilter): readonly StationMetricValue[] {
  if (key.startsWith('lp_med')) return YOKOHAMA_LP_MED
  if (filter.municipality === '川崎市') return KAWASAKI_POP_GR
  return YOKOHAMA_POP_GR
}

beforeEach(() => {
  vi.resetAllMocks()
  names.summaryAreasDeps.mockReturnValue(NAME_DEPS)
  db.areaRows.mockImplementation(async (keys: readonly string[], withChildren: boolean) =>
    rowsFor(keys, withChildren),
  )
  db.areaStationStats.mockResolvedValue(YOKOHAMA_STATION_STATS)
  db.stationMetricValues.mockImplementation(async (key: string, filter: StationFilter) => {
    const values = valuesFor(key, filter)
    return { stationCount: values.length, values }
  })
})

afterEach(() => {
  resetRateLimitStore()
})

type Input = Parameters<typeof TOOL_SPECS.getAreaSummary.run>[0]

async function run(input: unknown, viewport: Viewport | null = null) {
  const spec = TOOL_SPECS.getAreaSummary
  const parsed: Input = spec.inputSchema.parse(input)
  return spec.run(parsed, { ...CTX, viewport })
}

function areaEffectOf(effects: readonly ToolEffect[]): AreaSummaryEffect {
  const effect = effects.find((each): each is AreaSummaryEffect => each.kind === 'areaSummary')
  if (effect === undefined) throw new Error('エリアの要約の副産物がありません')
  return effect
}

/** LLM 向けの要約を JSON の形で読む（型の共用体を潰さずに中身を見る）。 */
function llmOf(forLlm: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(forLlm))
}

describe('横浜市全体（区域の値・内訳・駅の周り・色分け）', () => {
  it('LLM へはサーバが書いた文（年と増減・作り方・内訳の上位と下位・答え方）', async () => {
    const { effects, forLlm } = await run({ areas: [{ municipality: '横浜市' }] })
    const llm = llmOf(forLlm)
    expect(llm.areas).toEqual([
      expect.objectContaining({
        name: '神奈川県横浜市',
        totals: expect.arrayContaining([
          expect.objectContaining({
            headline: '3,750,952 人（2025年）・2020→2025年で -0.7%（2015→2020年は +1.4%）',
            method: '公表値',
          }),
        ]),
      }),
    ])
    expect(JSON.stringify(llm)).toContain('西区 +3.1%')
    expect(JSON.stringify(llm)).toContain('金沢区 -3.4%')
    expect(JSON.stringify(llm)).toContain('エリア全体の値ではない')
    expect(llm.answerGuide).toBe(AREA_SUMMARY_ANSWER_GUIDE_JA)
    expect(llm.coloring).toMatchObject({
      colored: true,
      metric: '人口増減率（2015→2020年・1km圏）',
    })
    expect(areaEffectOf(effects).response.areas[0]?.ref).toBe('muni:14100')
  })

  it('パネルは要約・推移・内訳（会話の中）、地図は横浜市の駅の色分け、⤢ はまだ無い', async () => {
    const { effects } = await run({ areas: [{ municipality: '横浜市' }] })
    const effect = areaEffectOf(effects)
    const panels = panelsForAreaSummary(effect)
    expect(panels.map((panel) => panel.type)).toEqual(['areaSummary', 'trendChart', 'barChart'])
    expect(panels.every((panel) => panel.placement === 'inline')).toBe(true)
    expect(mapActionsForEffect(effect)).toEqual([
      { type: 'colorStations', metricKey: 'pop_gr_2020_2015_1km', areas: ['muni:14100'] },
    ])
    expect(promotionsFor(effects)).toEqual([null, null, null])
    expect(mapResponseSchema.safeParse(assemble(effects, '横浜市は減っています。')).success).toBe(
      true,
    )
  })
})

describe('比較・色分けの指定・半径', () => {
  it('横浜市と川崎市は 1 回で比べる（比べる表・内訳は出さない）', async () => {
    const { effects, forLlm } = await run({
      areas: [{ municipality: '横浜市' }, { municipality: '川崎市' }],
    })
    expect(llmOf(forLlm).comparison).toMatchObject({ areas: ['神奈川県横浜市', '神奈川県川崎市'] })
    const panels = panelsForAreaSummary(areaEffectOf(effects))
    expect(panels.map((panel) => panel.type)).toEqual(['areaSummary', 'trendChart'])
    expect(mapActionsForEffect(areaEffectOf(effects))).toEqual([
      {
        type: 'colorStations',
        metricKey: 'pop_gr_2020_2015_1km',
        areas: ['muni:14100', 'muni:14130'],
      },
    ])
  })

  it('色分けしない（none）なら地図の操作を送らず、そう言う（色分けしたと書かせない）', async () => {
    const { effects, forLlm } = await run({ areas: [{ municipality: '横浜市' }], colorBy: 'none' })
    expect(mapActionsForEffect(areaEffectOf(effects))).toEqual([])
    expect(llmOf(forLlm).coloring).toEqual({
      colored: false,
      meaning: '色分けしていない（colorBy:none）。',
    })
    expect(db.stationMetricValues).not.toHaveBeenCalled()
  })

  it('色分けの指標はファミリ名で受け、半径つきのキーに決める（地価の中央値・1km）', async () => {
    const { effects, forLlm } = await run({
      areas: [{ municipality: '横浜市' }],
      colorBy: 'lp_med',
    })
    // 決め方（既定の年）は色分けの欄に書く（名前の読み替えの欄に混ぜない）
    expect(llmOf(forLlm).coloring).toMatchObject({ note: '色分けの指標：2026年（既定）' })
    expect(llmOf(forLlm)).not.toHaveProperty('nameNotes')
    expect(db.stationMetricValues).toHaveBeenCalledWith('lp_med_2026_1km', expect.anything())
    expect(mapActionsForEffect(areaEffectOf(effects))[0]).toMatchObject({
      metricKey: 'lp_med_2026_1km',
    })
  })

  it('6 つ以外の半径は 1km にして言う', async () => {
    const { effects, forLlm } = await run({ areas: [{ municipality: '横浜市' }], radiusM: 3000 })
    expect(areaEffectOf(effects).response.radiusM).toBe(1000)
    expect(llmOf(forLlm).nameNotes).toContain('半径 3000m は無いため、1km圏で集計しました。')
  })
})

describe('LLM 向けの要約の形', () => {
  it('内訳は増減の大きい順と小さい順（「増えた上位」とは書かない）・色の段は駅のある段だけ', async () => {
    const { effects } = await run({ areas: [{ municipality: '横浜市' }] })
    const response = areaEffectOf(effects).response
    const legend = response.legend
    const [first, ...rest] = legend?.classes ?? []
    if (first === undefined || legend === null) throw new Error('凡例がありません')
    const emptied = {
      ...response,
      legend: { ...legend, classes: [{ ...first, count: 0 }, ...rest] },
    }
    expect(JSON.stringify(llmOf(areaSummaryForLlm(emptied, [])).coloring)).not.toContain(
      first.labelJa,
    )
    const areas = JSON.stringify(llmOf(areaSummaryForLlm(response, [])).areas)
    expect(areas).toContain('"highest":["西区 +3.1%')
    expect(areas).toContain('"lowest":["金沢区 -3.4%')
    expect(areas).toContain('上位でも増えたとは限らない')
  })
})

describe('理由を返して集計しない', () => {
  it('知らない色分けの指標（候補つき）', async () => {
    const { effects, forLlm } = await run({ areas: [{ municipality: '横浜市' }], colorBy: 'nope' })
    expect(effects).toEqual([])
    expect(llmOf(forLlm)).toHaveProperty('error')
    expect(db.areaRows).not.toHaveBeenCalled()
  })

  it('決まらない名前は候補つきの理由（推測で選ばない）', async () => {
    const { effects, forLlm } = await run({ areas: [{ municipality: 'ほげ市' }] })
    expect(effects).toEqual([])
    expect(JSON.stringify(forLlm)).toContain('市区町村「ほげ市」が見つかりません')
    expect(db.areaRows).not.toHaveBeenCalled()
  })

  it('エリアは 1〜4 つ（5 つは入力の形で弾く）', () => {
    const five = Array.from({ length: 5 }, () => ({ municipality: '横浜市' }))
    expect(TOOL_SPECS.getAreaSummary.inputSchema.safeParse({ areas: five }).success).toBe(false)
    expect(TOOL_SPECS.getAreaSummary.inputSchema.safeParse({ areas: [] }).success).toBe(false)
  })
})

describe('地図の範囲（アプリのチャットだけ）', () => {
  it('このあたり（inMapView）は送信時の地図の範囲で、範囲の駅の分布と色分け（区域の値は出さない）', async () => {
    const { effects } = await run(
      { areas: [{ inMapView: true }], colorBy: 'lp_med' },
      YOKOHAMA_VIEW,
    )
    const effect = areaEffectOf(effects)
    expect(effect.response.areas[0]).toMatchObject({ kind: 'bbox', totals: [] })
    expect(mapActionsForEffect(effect)).toEqual([
      {
        type: 'colorStations',
        metricKey: 'lp_med_2026_1km',
        areas: ['bbox:139.55,35.4,139.72,35.55'],
      },
    ])
    // 区域の行は引かない（鍵が無いので、本物の areaRows は DB に行かずに空を返す）。
    expect(db.areaRows).toHaveBeenCalledWith([], true)
  })
})

type RegisteredTool = {
  readonly name: string
  /** 広告した入力の型（MCP の SDK はこれで入力を検めてから callback を呼ぶ）。 */
  readonly inputSchema: z.ZodTypeAny
  readonly callback: (input: unknown) => Promise<McpToolResult>
}

function mcpTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  const server: McpToolRegistry = {
    registerTool: (name, config, callback) => {
      tools.push({ name, inputSchema: config.inputSchema, callback })
    },
    registerResource: () => {},
  }
  registerMcpTools(server, 'http://localhost:3000')
  return tools
}

/** SDK と同じく、広告した型で入力を検めてから呼ぶ（知らない引数は外れる）。 */
function callLikeSdk(tool: RegisteredTool, args: unknown): Promise<McpToolResult> {
  return tool.callback(tool.inputSchema.parse(args))
}

function mcpTool(name: string): RegisteredTool {
  const tool = mcpTools().find((each) => each.name === name)
  if (tool === undefined) throw new Error(`${name} が登録されていない`)
  return tool
}

describe('道具の説明（すべての問でモデルに見えている）', () => {
  it('地図の表示範囲・駅の道具の名前・起点の駅から N m を書かない（関係の無い問の最初の一手が変わった・§6.17.1）', () => {
    const { description } = TOOL_SPECS.getAreaSummary
    // 「…地図の表示範囲の全体」と書くと「この区で人口が増えている駅は？」が地図の範囲で絞った（区で答えたのは 10 回中 6 回）
    expect(description).not.toContain('地図の表示範囲')
    // 「1 つの駅の値は駅の道具（getStationDetail・getStationProfile）」と書くと「東京駅の人口推移」が 5 回とも getStationProfile へ
    expect(description).not.toMatch(/getStation(Detail|Profile)/)
    // 冒頭に「起点の駅から N m」と書くと「東京駅と新宿駅の人口を比べて」を駅から 1km のエリア 2 つとして比べた（5 回中 5 回）
    expect(description).not.toContain('起点の駅から')
    const { near } = TOOL_SPECS.getAreaSummary.inputSchema.shape.areas.element.shape
    expect(near.unwrap().description).toContain('起点の駅から N m')
    // 駅を並べる問いとの線引きは残す（「横浜市で人口が増えている駅は？」は rankStations）
    expect(description).toContain('駅を並べる問い（「人口が増えている駅は？」）は rankStations')
  })
})

describe('MCP（15 本目・get_area_summary）', () => {
  it('登録され、present:"echarts" で推移と内訳の図も返す（要約そのものは表と文なので図にしない）', async () => {
    expect(MCP_TOOL_CONFIGS.getAreaSummary.mcpName).toBe('get_area_summary')
    expect(mcpTools()).toHaveLength(15)
    const result = await mcpTool('get_area_summary').callback({
      areas: [{ municipality: '横浜市' }],
      present: 'echarts',
    })
    expect(result.isError).toBeUndefined()
    const structured = JSON.parse(JSON.stringify(result.structuredContent))
    expect(structured.panels.map((panel: { type: string }) => panel.type)).toEqual([
      'areaSummary',
      'trendChart',
      'barChart',
    ])
    expect(structured.mapActions[0]).toMatchObject({ type: 'colorStations' })
    expect(structured.presenters.echarts).toBeDefined()
    expect(structured.result.answerGuide).toBe(AREA_SUMMARY_ANSWER_GUIDE_JA)
  })

  it('MCP に地図の範囲は無い：inMapView が送られてきても外れて空のエリアになり、理由つきで断る（集計しない）', async () => {
    const result = await callLikeSdk(mcpTool('get_area_summary'), { areas: [{ inMapView: true }] })
    const text = JSON.stringify(result.structuredContent)
    expect(text).toContain('エリアが空です')
    // 使えない inMapView を勧めない（勧めると、同じ呼び直しを繰り返す）
    expect(text).not.toContain('inMapView')
    expect(db.areaRows).not.toHaveBeenCalled()
  })
})
