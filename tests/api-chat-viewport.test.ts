/**
 * `/api/chat` が、送信に同送された**地図の表示範囲**（`bbox`）をツールへ渡し、同じ名前の路線をそれで決めることを、
 * ルートごと確かめる（2026-10-08 L3・`docs/261001_fix_user_feedback_ui.md` §6.8.6）。
 *
 * - 大阪を見ている人の「中央線」は大阪メトロ中央線（聞き返さない）。首都圏なら JR中央線(快速)
 * - 範囲が無い・形が崩れている送信は、範囲なしとして続ける（会話は止めない）——同じ名前の路線は聞き返す
 * - ⤢ の条件（data-promotions）にも、決まった路線のコードが載る
 *
 * モデルは `MockLanguageModelV3`、DB は `@/db/queries` を差し替える。ツール・名前の解決・ルートは本物を通す。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { clearRouteNameCache } from '@/ai/routes/catalog'
import { panelPromotionsSchema, type PanelPromotions } from '@/shared/promotion'
import { type ListStationsFilter, type RankRow } from '@/db/queries'
import { type StationListItem } from '@/shared/api'
import { viewportToTuple } from '@/shared/viewport'
import { LEGAL_ROUTES, OPERATORS, VIEW, hasStationsInView, lineRows } from './fixtures/line-catalog'

const current: { model: MockLanguageModelV3 | null } = { model: null }

vi.mock('@/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/client')>()
  return { ...actual, chatModel: () => current.model, isChatConfigured: () => true }
})

const db = vi.hoisted(() => ({ rankByColumn: vi.fn(), listStations: vi.fn() }))

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

/** 「中央線の駅で地価が高い順」をランキングで 1 回呼ぶモデルに、地図の文脈つきで送る。 */
async function askChuo(
  extra: Record<string, unknown>,
): Promise<{ status: number; chunks: Chunk[] }> {
  current.model = modelAnswering([
    toolCallStep('rankStations', { metric: 'lp_near_price', routes: ['中央線'] }),
    TEXT_STEP,
  ])
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '198.51.100.9' },
      body: JSON.stringify({
        messages: [
          { role: 'user', parts: [{ type: 'text', text: '中央線の駅で地価が高い順は？' }] },
        ],
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
