/**
 * 初回応答の打ち切り（`src/ai/client.ts` の `createTimedFetch`）が、SDK をどう抜けてきて、
 * どう分類されるか——**本物のプロバイダ（`@ai-sdk/google`）に偽の通信**をつないで確かめる。
 *
 * ## きっかけ（2026-09-25 の障害）
 *
 * 本番のチャットは 31 秒待って「応答の生成に失敗しました」と返した。コードを読むと、
 * `createTimedFetch` が初回応答を **15 秒で打ち切って 1 回だけ再試行**する——15 秒 ×2 で 31 秒と合う。
 * 初回のチャンクが 2 回とも 15 秒以内に出なかった、という筋である（考え込みではなく提供元のまれな
 * 停滞——打ち切って再試行すれば即座に返る。`docs/260926_chat_model_eval.md` §4）。
 *
 * このとき投げられる `FirstChunkTimeoutError` は `APICallError` ではないので、**SDK は再試行せず、
 * 包みもしない**。PR #160 の分類はこれを知らず、`unknown`（「生成に失敗」）に落としていた。
 * 本当は「提供元が時間内に応答しなかった」＝一時的な不調である。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText } from 'ai'
import { classifyChatFailure } from '@/ai/chat-errors'
import { createTimedFetch, FirstChunkTimeoutError } from '@/ai/client'

/** テストでは 15 秒ではなく短く切る（仕組みは同じ）。 */
const FIRST_CHUNK_TIMEOUT_MS = 60

/**
 * 応答ヘッダはすぐ返すが、**本文の最初のチャンクを送らない**（思考型が考え込んでいる状態）。
 * 打ち切られたら、その理由で本文を閉じる（本物の fetch と同じ振る舞い）。
 */
function stallingNetwork(calls: { count: number }): typeof globalThis.fetch {
  return async (_input, init) => {
    calls.count += 1
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('初回応答が来ないとき（2026-09-25 の障害の形）', () => {
  it('打ち切り 1 回＋再試行 1 回で諦め、FirstChunkTimeoutError がそのまま SDK を抜けてくる', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = { count: 0 }
    vi.stubGlobal('fetch', stallingNetwork(calls))
    const provider = createGoogleGenerativeAI({
      apiKey: 'test-key',
      fetch: createTimedFetch(FIRST_CHUNK_TIMEOUT_MS),
    })
    const errors: unknown[] = []
    const result = streamText({
      model: provider('gemini-test'),
      prompt: 'こんにちは',
      maxRetries: 1, // 本番と同じ。SDK はこれを APICallError にしか使わない
      onError: ({ error }) => {
        errors.push(error)
      },
    })
    await result.consumeStream()

    // SDK は再試行しない（APICallError ではないため）——通信は timedFetch の 2 回だけ
    expect(calls.count).toBe(2)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(FirstChunkTimeoutError)
  })

  it('分類は「一時的に応答できない」（待てば直る）であって「生成に失敗」ではない', () => {
    const failure = classifyChatFailure(new FirstChunkTimeoutError(15_000))
    expect(failure.kind).toBe('unavailable')
    expect(failure.attempts).toBe(2)
    expect(failure.name).toBe('FirstChunkTimeoutError')
  })
})
