/**
 * `/api/chat` が、送信に同送された**地図の表示範囲**（`bbox`）をツールへ渡し、同じ名前の路線をそれで決めることを、
 * ルートごと確かめる（2026-10-08 L3・`docs/261001_fix_user_feedback_ui.md` §6.8.6）。
 *
 * - 大阪を見ている人の「中央線」は大阪メトロ中央線（聞き返さない）。首都圏なら JR中央線(快速)
 * - 範囲が無い・形が崩れている送信は、範囲なしとして続ける（会話は止めない）——同じ名前の路線は聞き返す
 * - ⤢ の条件（data-promotions）にも、決まった路線のコードが載る
 *
 * 2026-10-09 B3：「このあたり」——地図の範囲を LLM にも伝える（広さと中心に近い駅だけ。範囲の数は見せない）。
 * ツールの `inMapView` で、送信時の範囲そのもので絞る。範囲が無ければ地図の節は足さず、日本全体に近い広さなら
 * 聞き返させる。全駅の索引が読めなくても会話は止めない。
 *
 * モデルは `MockLanguageModelV3`、DB は `@/db/queries` を差し替える。ツール・名前の解決・ルートは本物を通す。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { clearRouteNameCache } from '@/ai/routes/catalog'
import { clearAreaCache } from '@/ai/area/catalog'
import { panelPromotionsSchema, type PanelPromotions } from '@/shared/promotion'
import { type ListStationsFilter, type RankRow } from '@/db/queries'
import { type StationListItem } from '@/shared/api'
import { viewportToTuple } from '@/shared/viewport'
import { LEGAL_ROUTES, OPERATORS, VIEW, hasStationsInView, lineRows } from './fixtures/line-catalog'
import { AREA_STATIONS } from './fixtures/area-catalog'

const current: { model: MockLanguageModelV3 | null } = { model: null }

vi.mock('@/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/client')>()
  return { ...actual, chatModel: () => current.model, isChatConfigured: () => true }
})

const db = vi.hoisted(() => ({
  rankByColumn: vi.fn(),
  listStations: vi.fn(),
  stationCatalog: vi.fn(),
  stationByGrp: vi.fn(),
}))

const RANK_ROWS: RankRow[] = [
  { grp: '本町#0', stationName: '本町', prefecture: '大阪府', value: 9, flagValue: 0, rank: 1 },
]

function station(): StationListItem {
  return {
    grp: '本町#0',
    stationName: '本町',
    label: '本町',
    prefecture: '大阪府',
    municipality: null,
    municipalityCode: null,
    lon: 135.5,
    lat: 34.68,
    nOp: 1,
    paxLatest: null,
  }
}

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return {
    ...actual,
    ...db,
    lineNames: async () => lineRows(),
    operatorNames: async () => OPERATORS,
    routeNames: async () =>
      LEGAL_ROUTES.map((row) => ({ ...row, stationCount: 1, routeTypes: [] })),
  }
})

const { POST } = await import('@/app/api/chat/route')

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}
const START = { type: 'stream-start' as const, warnings: [] }

type StepAnswer = Awaited<ReturnType<MockLanguageModelV3['doStream']>>

function toolCallStep(toolName: string, input: Record<string, unknown>): StepAnswer {
  return {
    stream: simulateReadableStream({
      chunks: [
        START,
        { type: 'tool-call' as const, toolCallId: 'c1', toolName, input: JSON.stringify(input) },
        {
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: 'STOP' },
          usage: USAGE,
        },
      ],
    }),
  }
}

const TEXT_STEP: StepAnswer = {
  stream: simulateReadableStream({
    chunks: [
      START,
      { type: 'text-start' as const, id: 't1' },
      { type: 'text-delta' as const, id: 't1', delta: '表示しました。' },
      { type: 'text-end' as const, id: 't1' },
      {
        type: 'finish' as const,
        finishReason: { unified: 'stop' as const, raw: 'STOP' },
        usage: USAGE,
      },
    ],
  }),
}

function modelAnswering(steps: readonly StepAnswer[]): MockLanguageModelV3 {
  const queue = [...steps]
  return new MockLanguageModelV3({
    doStream: async () => {
      const next = queue.shift()
      if (next === undefined) throw new Error('テストの応答を使い切った')
      return next
    },
  })
}

type Chunk = Record<string, unknown>

function isChunk(value: unknown): value is Chunk {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** ランキングを 1 回呼ぶモデルに、地図の文脈つきで送る。 */
async function ask(
  question: string,
  rankInput: Record<string, unknown>,
  extra: Record<string, unknown>,
): Promise<{ status: number; chunks: Chunk[] }> {
  current.model = modelAnswering([toolCallStep('rankStations', rankInput), TEXT_STEP])
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '198.51.100.9' },
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: question }] }],
        ...extra,
      }),
    }),
  )
  const body = await response.text()
  const chunks = body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map((line): unknown => JSON.parse(line.slice('data: '.length)))
    .filter(isChunk)
  return { status: response.status, chunks }
}

/** 「中央線の駅で地価が高い順」をランキングで 1 回呼ぶモデルに、地図の文脈つきで送る。 */
function askChuo(extra: Record<string, unknown>): Promise<{ status: number; chunks: Chunk[] }> {
  return ask('中央線の駅で地価が高い順は？', { metric: 'lp_near_price', routes: ['中央線'] }, extra)
}

/** モデルが受け取ったシステムプロンプト（1 回目の呼び出し）。 */
function systemPrompt(): string {
  const prompt = current.model?.doStreamCalls[0]?.prompt ?? []
  const system = prompt.find((message) => message.role === 'system')
  return system !== undefined && typeof system.content === 'string' ? system.content : ''
}

function lastPromotions(chunks: Chunk[]): PanelPromotions {
  const data = chunks.filter((chunk) => chunk.type === 'data-promotions').at(-1)?.data
  return panelPromotionsSchema.parse(data)
}

/** ツールの結果（LLM に返したもの）の JSON。 */
function toolOutputs(chunks: Chunk[]): string {
  return JSON.stringify(chunks.filter((chunk) => chunk.type === 'tool-output-available'))
}

beforeEach(() => {
  resetRateLimitStore()
  clearRouteNameCache()
  clearAreaCache()
  db.stationCatalog.mockResolvedValue([...AREA_STATIONS])
  db.stationByGrp.mockResolvedValue({
    grp: '竹橋#0',
    stationName: '竹橋',
    label: '竹橋',
    searchLabel: '竹橋（東京都）',
    prefecture: '東京都',
    municipality: '千代田区',
    lon: 139.75852,
    lat: 35.69028,
    nOp: 1,
    operators: '東京地下鉄',
    paxLatest: 42156,
    lpNearUse: null,
    levelComplete: true,
  })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: RANK_ROWS.length })
  db.listStations.mockImplementation(async (filter: ListStationsFilter) =>
    filter.bbox !== undefined && hasStationsInView(filter.lines ?? [], filter.bbox)
      ? [station()]
      : [],
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  current.model = null
})

describe('/api/chat：地図の表示範囲で、同じ名前の路線を決める', () => {
  it('大阪の地図を見ていれば「中央線」は大阪メトロ中央線（聞き返さずに図を出す）', async () => {
    const { status, chunks } = await askChuo({ bbox: viewportToTuple(VIEW.osaka) })
    expect(status).toBe(200)
    expect(db.rankByColumn.mock.calls[0]?.[1]?.lines).toEqual([99621])
    expect(lastPromotions(chunks)).toEqual([expect.objectContaining({ lines: [99621] })])
    expect(toolOutputs(chunks)).toContain('地図の表示範囲に駅のある 大阪メトロ中央線')
  })

  it('首都圏の地図なら JR中央線(快速)', async () => {
    await askChuo({ bbox: viewportToTuple(VIEW.tokyo) })
    expect(db.rankByColumn.mock.calls[0]?.[1]?.lines).toEqual([11312])
  })

  it('範囲を送らなければ、同じ名前の路線は聞き返す（図を作らない・集計しない）', async () => {
    const { status, chunks } = await askChuo({})
    expect(status).toBe(200)
    expect(db.rankByColumn).not.toHaveBeenCalled()
    expect(toolOutputs(chunks)).toContain('複数あります')
  })

  it.each([
    ['3 値', [135, 34, 136]],
    ['西と東が逆', [136.48, 34.23, 134.51, 35.18]],
    ['範囲の外の緯度', [134.51, -95, 136.48, 35.18]],
    ['数でない', ['west', 34.23, 136.48, 35.18]],
  ])('範囲の形が崩れていても（%s）会話は止めず、範囲なしとして続ける', async (_label, bbox) => {
    const { status, chunks } = await askChuo({ bbox })
    expect(status).toBe(200)
    expect(db.rankByColumn).not.toHaveBeenCalled()
    expect(toolOutputs(chunks)).toContain('複数あります')
  })
})

describe('/api/chat：「このあたり」——地図の表示範囲（2026-10-09 B3）', () => {
  /** 竹橋の周り（約 7km 四方）。 */
  const TAKEBASHI_TUPLE = [139.72, 35.66, 139.8, 35.72]
  const JAPAN_TUPLE = [122.9, 24.0, 153.9, 45.6]
  const NEAR_HERE = 'このあたりで地価が上がっている駅は？'

  it('LLM には地図の広さと中心に近い駅だけを見せる（範囲の数は見せない）', async () => {
    const { status } = await ask(
      NEAR_HERE,
      { metric: 'lp_gr', inMapView: true },
      {
        bbox: TAKEBASHI_TUPLE,
      },
    )
    expect(status).toBe(200)
    const prompt = systemPrompt()
    expect(prompt).toContain('# 地図の表示範囲（「このあたり」）')
    expect(prompt).toContain('中心に近い駅は 竹橋（東京都千代田区）')
    expect(prompt).toContain('inMapView:true')
    expect(prompt).not.toContain('139.72')
  })

  it('inMapView は送信時の範囲そのもので絞り、⤢ の条件にも同じ範囲が載る', async () => {
    const { chunks } = await ask(
      NEAR_HERE,
      { metric: 'lp_gr', inMapView: true },
      {
        bbox: TAKEBASHI_TUPLE,
      },
    )
    const range = { west: 139.72, south: 35.66, east: 139.8, north: 35.72 }
    expect(db.rankByColumn.mock.calls[0]?.[1]?.bbox).toEqual(range)
    expect(lastPromotions(chunks)).toEqual([expect.objectContaining({ bbox: range })])
    expect(toolOutputs(chunks)).toContain('地図の表示範囲')
  })

  it('範囲を送らなければ地図の節は足さない。inMapView は直し方を返す（集計しない）', async () => {
    const { status, chunks } = await ask(NEAR_HERE, { metric: 'lp_gr', inMapView: true }, {})
    expect(status).toBe(200)
    expect(systemPrompt()).not.toContain('# 地図の表示範囲')
    expect(db.rankByColumn).not.toHaveBeenCalled()
    expect(toolOutputs(chunks)).toContain('地図の表示範囲が届いていません')
  })

  it('日本全体に近い広さなら、聞き返させる節だけ（索引も読まない）', async () => {
    await ask(NEAR_HERE, { metric: 'lp_gr' }, { bbox: JAPAN_TUPLE })
    const prompt = systemPrompt()
    expect(prompt).toContain('日本全体に近い広さ')
    expect(prompt).not.toContain('inMapView:true')
    expect(db.stationCatalog).not.toHaveBeenCalled()
  })

  it('全駅の索引が読めなくても、会話は止めない（広さだけ伝え、中心の駅を挙げない）', async () => {
    db.stationCatalog.mockRejectedValue(new Error('DB が落ちている'))
    const { status } = await ask(
      NEAR_HERE,
      { metric: 'lp_gr', inMapView: true },
      {
        bbox: TAKEBASHI_TUPLE,
      },
    )
    expect(status).toBe(200)
    const prompt = systemPrompt()
    expect(prompt).toContain('利用者の地図は、いま 約 7.2km × 6.7km の範囲を表示しています。')
    expect(prompt).not.toContain('中心に近い駅')
    expect(db.rankByColumn).toHaveBeenCalled()
  })

  it('選択駅の文脈と地図の範囲は、両方とも足す（選択駅が先）', async () => {
    await ask(
      '地価の推移は？',
      { metric: 'lp_gr' },
      {
        bbox: TAKEBASHI_TUPLE,
        selectedGrp: '竹橋#0',
        radiusM: 1000,
      },
    )
    const prompt = systemPrompt()
    expect(prompt.indexOf('# 現在の地図の状態')).toBeGreaterThan(0)
    expect(prompt.indexOf('# 地図の表示範囲')).toBeGreaterThan(prompt.indexOf('# 現在の地図の状態'))
  })
})
