/**
 * `/api/chat` が、図（data-map）と一緒に**その図を生んだ条件**（data-promotions）を送ることを、ルートごと確かめる。
 *
 * ## きっかけ（2026-09-26）
 *
 * 画面は ⤢ とキャンバスの条件を、パネルとツール呼び出しを照合して推し量っていた。同じ指標で呼び出しが
 * 2 つあると（本物の応答：事業者名に「新幹線」を渡して 0 件の図 → 絞り込みを外して呼び直し、点のある図）、
 * どちらの図も最初の呼び出しの条件で開いた。いまは、サーバが副産物から条件を作ってパネルと同じ並びで送る。
 *
 * ## やり方
 *
 * モデルは `MockLanguageModelV3`、データベースは `@/db/queries` の 2 関数だけを差し替える。ツール
 * （`tool-specs.ts`）・SDK・ルートは本物を通す——条件が**本物の副産物**から作られることを見るため。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { panelPromotionsSchema, type PanelPromotions } from '@/shared/promotion'
import { mapResponseSchema, type MapResponse } from '@/shared/protocol'
import { type RankRow, type ScatterFilters, type ScatterRow } from '@/db/queries'

const current: { model: MockLanguageModelV3 | null } = { model: null }

vi.mock('@/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/client')>()
  return { ...actual, chatModel: () => current.model, isChatConfigured: () => true }
})

const SCATTER_ROWS: ScatterRow[] = [
  { grp: 'A#0', stationName: 'A駅', x: 5, y: -3, xFlag: 0, yFlag: 0 },
  { grp: 'B#0', stationName: 'B駅', x: 8, y: -6, xFlag: 0, yFlag: 0 },
]
const RANK_ROWS: RankRow[] = [
  { grp: 'C#0', stationName: 'C駅', prefecture: '千葉県', value: 12.3, flagValue: 0, rank: 1 },
]

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return {
    ...actual,
    // 存在しない事業者名（「新幹線」）で絞ると 0 件になる——本物の応答で起きた形
    scatterPoints: async (
      _x: string,
      _y: string,
      _xFlag: string | null,
      _yFlag: string | null,
      filters: ScatterFilters,
    ): Promise<ScatterRow[]> => (filters.operators.includes('新幹線') ? [] : SCATTER_ROWS),
    rankByColumn: async (): Promise<{ rows: RankRow[]; total: number }> => ({
      rows: RANK_ROWS,
      total: RANK_ROWS.length,
    }),
  }
})

const { POST } = await import('@/app/api/chat/route')

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}
const START = { type: 'stream-start' as const, warnings: [] }

type StepAnswer = Awaited<ReturnType<MockLanguageModelV3['doStream']>>

/** 1 手順でツールを 1 回呼ぶ応答。 */
function toolCallStep(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
): StepAnswer {
  return {
    stream: simulateReadableStream({
      chunks: [
        START,
        { type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input) },
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

/** 呼ばれるたびに次の応答を返すモデル（配列を渡す形は 1 回目に 2 番目を返すので使わない）。 */
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

async function ask(): Promise<Chunk[]> {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '198.51.100.8' },
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: '新幹線の駅で散布図を見せて' }] }],
      }),
    }),
  )
  const body = await response.text()
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map((line): unknown => JSON.parse(line.slice('data: '.length)))
    .filter(isChunk)
}

/** 最後に届いた図と条件（どちらも段階的に上書きされるので、最後が権威）。 */
function lastMapAndPromotions(chunks: Chunk[]): { map: MapResponse; promotions: PanelPromotions } {
  const lastData = (type: string): unknown =>
    chunks.filter((chunk) => chunk.type === type).at(-1)?.data
  return {
    map: mapResponseSchema.parse(lastData('data-map')),
    promotions: panelPromotionsSchema.parse(lastData('data-promotions')),
  }
}

beforeEach(() => {
  resetRateLimitStore()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  current.model = null
})

describe('図と一緒に、その図を生んだ条件を送る', () => {
  it('同じ指標の図が 2 つあっても、それぞれの図に自分の条件が付く', async () => {
    current.model = modelAnswering([
      toolCallStep('c1', 'compareGrowth', {
        x: 'pop_gr_2020_2015_1km',
        y: 'rate_covid',
        operators: ['新幹線'],
        routeTypes: [1],
      }),
      toolCallStep('c2', 'compareGrowth', {
        x: 'pop_gr_2020_2015_1km',
        y: 'rate_covid',
        routeTypes: [1],
      }),
      TEXT_STEP,
    ])
    const { map, promotions } = lastMapAndPromotions(await ask())

    expect(map.panels.map((panel) => panel.type)).toEqual(['scatter', 'scatter'])
    expect(promotions).toHaveLength(map.panels.length)
    const [empty, retried] = promotions
    expect(empty).toMatchObject({ kind: 'scatter', operators: ['新幹線'], routeTypes: [1] })
    expect(retried).toMatchObject({ kind: 'scatter', operators: [], routeTypes: [1] })
    expect(retried).toMatchObject({ xKey: 'pop_gr_2020_2015_1km', yKey: 'rate_covid' })
  })

  it('失敗を返した呼び出しには条件が付かない（図を生んだ呼び直しの条件だけ）', async () => {
    current.model = modelAnswering([
      toolCallStep('c1', 'rankStations', {
        metric: 'pop_gr_2020_2015_1km',
        prefectures: ['千葉市'],
      }),
      toolCallStep('c2', 'rankStations', {
        metric: 'pop_gr_2020_2015_1km',
        prefectures: ['千葉県'],
        excludeLowN: true,
      }),
      TEXT_STEP,
    ])
    const { map, promotions } = lastMapAndPromotions(await ask())

    expect(map.panels.map((panel) => panel.type)).toEqual(['rankingTable'])
    expect(promotions).toEqual([
      {
        kind: 'ranking',
        metricKey: 'pop_gr_2020_2015_1km',
        order: 'desc',
        prefectures: ['千葉県'],
        operators: [],
        routes: [],
        routeTypes: [],
        excludeLowN: true,
      },
    ])
  })

  it('途中経過でも、条件は図より先に届く（図だけが条件の無いまま描かれる瞬間を作らない）', async () => {
    current.model = modelAnswering([
      toolCallStep('c1', 'compareGrowth', { x: 'pop_gr_2020_2015_1km', y: 'rate_covid' }),
      TEXT_STEP,
    ])
    const chunks = await ask()
    const types = chunks.map((chunk) => chunk.type)
    const firstMap = types.indexOf('data-map')
    expect(firstMap).toBeGreaterThan(0)
    expect(types[firstMap - 1]).toBe('data-promotions')
  })
})
