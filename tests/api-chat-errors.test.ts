/**
 * `/api/chat` が**提供元の失敗を種類で言い分け、中身をログに残す**ことを、ルートごと確かめる。
 *
 * ## きっかけ（2026-09-25 の障害）
 *
 * Gemini が一時的に応答しなくなったとき、本番は 31 秒待って「応答の生成に失敗しました」と返した。
 * 待てば直る不調なのに「失敗」と言い、しかも**ログには中身が残っていなかった**ので、
 * 429 か 5xx かを後から確かめられなかった。
 *
 * ## やり方
 *
 * モデルを `MockLanguageModelV3` に差し替え、**提供元が返しうる失敗をそのまま投げさせる**
 * （`APICallError` の状態番号・本文は Google の実際の形）。ルートの外から見えるもの——
 * 画面に届く SSE とサーバのログ——だけで判定する。本物のモデルには触らない。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APICallError, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { CHAT_FAILURE_JA } from '@/shared/chat-errors'
import { mapResponseSchema } from '@/shared/protocol'

const current: { model: MockLanguageModelV3 | null } = { model: null }

vi.mock('@/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ai/client')>()
  return {
    ...actual,
    chatModel: () => current.model,
    isChatConfigured: () => true,
    // 打ち切りの検査を速くする（本番は 50 秒）。他の場合はこれより十分早く終わる。
    CHAT_TIMEOUT_MS: 400,
  }
})

const { POST } = await import('@/app/api/chat/route')

/** 発話。ログに**出てはいけない**ものとして使う。 */
const UTTERANCE = '横浜市で中古マンションを探しています'

type Chunk = Record<string, unknown>

function isChunk(value: unknown): value is Chunk {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function ask(): Promise<Chunk[]> {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '198.51.100.7' },
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: UTTERANCE }] }],
      }),
    }),
  )
  expect(response.status).toBe(200)
  const body = await response.text()
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map((line): unknown => JSON.parse(line.slice('data: '.length)))
    .filter(isChunk)
}

const errorTextsOf = (chunks: Chunk[]): unknown[] =>
  chunks.filter((chunk) => chunk.type === 'error').map((chunk) => chunk.errorText)

/** 最後の data-map の一言（画面が本文の代わりに出す文）。 */
function fallbackTextOf(chunks: Chunk[]): string | undefined {
  const maps = chunks.filter((chunk) => chunk.type === 'data-map')
  const last = mapResponseSchema.safeParse(maps.at(-1)?.data)
  return last.success ? last.data.messages.at(-1)?.text : undefined
}

/** 提供元（Google）の失敗。本文は実際の形 `{"error":{"code","message","status"}}`。 */
function providerError(statusCode: number | undefined, status: string, retryable: boolean) {
  return new APICallError({
    message: `provider says ${status}`,
    url: 'https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent',
    requestBodyValues: {},
    statusCode,
    // SDK の再試行を待たせない（本番は Retry-After か 2 秒の指数バックオフ）。
    responseHeaders: { 'retry-after-ms': '1' },
    responseBody: JSON.stringify({
      error: { code: statusCode, message: `provider says ${status}`, status },
    }),
    isRetryable: retryable,
  })
}

function failingModel(error: unknown): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => {
      throw error
    },
  })
}

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

/** 本文を返して正常に終わるモデル。`text` が空なら、本文なしで終わる。 */
function answeringModel(text: string): MockLanguageModelV3 {
  const body =
    text.length === 0
      ? []
      : [
          { type: 'text-start' as const, id: 't1' },
          { type: 'text-delta' as const, id: 't1', delta: text },
          { type: 'text-end' as const, id: 't1' },
        ]
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          ...body,
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: 'STOP' },
            usage: USAGE,
          },
        ],
      }),
    }),
  })
}

/** 何も返さず、打ち切られるまで待つモデル。 */
function hangingModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: ({ abortSignal }) =>
      new Promise((_resolve, reject) => {
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason))
      }),
  })
}

const logged: string[] = []

beforeEach(() => {
  resetRateLimitStore()
  logged.length = 0
  const record = (...args: unknown[]): void => {
    logged.push(args.map(String).join(' '))
  }
  vi.spyOn(console, 'error').mockImplementation(record)
  vi.spyOn(console, 'info').mockImplementation(record)
})

afterEach(() => {
  vi.restoreAllMocks()
  current.model = null
})

const failureLines = (): string[] => logged.filter((line) => line.includes('model failure'))

/** 失敗 1 件につき記録は 1 行（派生の「出力が無かった」や重複を並べない）。その 1 行を返す。 */
function onlyFailureLine(): string {
  const lines = failureLines()
  expect(lines).toHaveLength(1)
  return lines[0] ?? ''
}

describe('提供元の失敗を、種類で言い分けて画面に送る', () => {
  it('503（過負荷）→ 待てば直ると言う。再試行して 2 回とも失敗したことがログに残る', async () => {
    current.model = failingModel(providerError(503, 'UNAVAILABLE', true))
    const chunks = await ask()
    expect(errorTextsOf(chunks)).toEqual([CHAT_FAILURE_JA.unavailable])
    const line = onlyFailureLine()
    expect(line).toContain('kind=unavailable')
    expect(line).toContain('status=503')
    expect(line).toContain('provider=UNAVAILABLE')
    expect(line).toContain('attempts=2')
  })

  it('500（提供元の内部エラー）→ 「生成に失敗」ではなく一時的な不調と言う（2026-09-25 の障害の形）', async () => {
    current.model = failingModel(providerError(500, 'INTERNAL', true))
    const chunks = await ask()
    expect(errorTextsOf(chunks)).toEqual([CHAT_FAILURE_JA.unavailable])
    expect(onlyFailureLine()).toContain('status=500')
  })

  it('429（無料枠の上限）→ 混雑と言う', async () => {
    current.model = failingModel(providerError(429, 'RESOURCE_EXHAUSTED', true))
    const chunks = await ask()
    expect(errorTextsOf(chunks)).toEqual([CHAT_FAILURE_JA.rate_limited])
    expect(onlyFailureLine()).toContain('provider=RESOURCE_EXHAUSTED')
  })

  it('400（鍵・モデル名・リクエストの形）→ こちらの設定の問題と言い、再試行しない', async () => {
    current.model = failingModel(providerError(400, 'INVALID_ARGUMENT', false))
    const chunks = await ask()
    expect(errorTextsOf(chunks)).toEqual([CHAT_FAILURE_JA.rejected])
    expect(onlyFailureLine()).toContain('attempts=1')
  })

  it('提供元に届かなかった（接続の失敗）→ 一時的な不調と言う', async () => {
    current.model = failingModel(providerError(undefined, 'unreachable', true))
    const chunks = await ask()
    expect(errorTextsOf(chunks)).toEqual([CHAT_FAILURE_JA.unavailable])
    expect(onlyFailureLine()).toContain('status=-')
  })

  it('提供元とは無関係の失敗 → 種類は unknown、名前はログに残る', async () => {
    current.model = failingModel(new TypeError('schema mismatch'))
    const chunks = await ask()
    expect(errorTextsOf(chunks)).toEqual([CHAT_FAILURE_JA.unknown])
    expect(onlyFailureLine()).toContain('name=TypeError')
  })
})

describe('ログに発話を残さない', () => {
  it('提供元の説明に発話が紛れていても、伏せて記録する', async () => {
    const leaky = new APICallError({
      message: `Invalid request: "${UTTERANCE}" could not be processed`,
      url: 'https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent',
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: false,
    })
    current.model = failingModel(leaky)
    await ask()
    expect(onlyFailureLine()).toContain('[発話]')
    for (const line of logged) expect(line).not.toContain(UTTERANCE)
  })
})

describe('失敗でない終わり方も、画面が一言出せる形で終わる', () => {
  it('打ち切り → エラーにはせず、「時間内に取得できませんでした」を data-map に載せる', async () => {
    current.model = hangingModel()
    const chunks = await ask()
    // 実際に流れる並び。画面は abort のあとの data-map の一文を吹き出しに出す（messageParts.displayTextOf）。
    expect(chunks.map((chunk) => chunk.type)).toEqual(['start', 'abort', 'data-map'])
    expect(errorTextsOf(chunks)).toEqual([])
    expect(fallbackTextOf(chunks)).toBe('時間内に取得できませんでした。もう一度お試しください。')
    expect(failureLines()).toEqual([])
    expect(logged.some((line) => line.startsWith('[api/chat] aborted'))).toBe(true)
  })

  it('本文なしで正常終了 → 代わりの一言を data-map に載せる', async () => {
    current.model = answeringModel('')
    const chunks = await ask()
    expect(errorTextsOf(chunks)).toEqual([])
    expect(fallbackTextOf(chunks)).toBe(
      'うまく取得できませんでした。指標や地域を変えて、もう一度お試しください。',
    )
  })

  it('成功 → 本文が流れ、失敗のログは出ない', async () => {
    current.model = answeringModel('こんにちは。')
    const chunks = await ask()
    expect(chunks.some((chunk) => chunk.type === 'text-delta')).toBe(true)
    expect(errorTextsOf(chunks)).toEqual([])
    expect(failureLines()).toEqual([])
  })
})
