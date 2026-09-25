/**
 * モデル呼び出しの失敗を、種類に分けて 1 行で記録する（`src/ai/chat-errors.ts`・純関数）。
 *
 * ルートごとの確かめは `tests/api-chat-errors.test.ts`。ここでは境界——状態番号の区切り、
 * 再試行の数え方、記録の長さと伏せ方——を 1 つずつ固定する。
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { APICallError, NoOutputGeneratedError, RetryError } from 'ai'
import {
  chatFailureLogLine,
  classifyChatFailure,
  failuresToRecord,
  isOwnAbort,
} from '@/ai/chat-errors'

function apiError(
  statusCode: number | undefined,
  options: { retryable?: boolean; body?: string } = {},
) {
  return new APICallError({
    message: `status ${statusCode ?? 'none'}`,
    url: 'https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent',
    requestBodyValues: {},
    statusCode,
    responseBody: options.body,
    isRetryable: options.retryable ?? false,
  })
}

describe('状態番号で種類を決める（待てば直るか）', () => {
  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [408, 'unavailable'],
    [400, 'rejected'],
    [401, 'rejected'],
    [403, 'rejected'],
    [404, 'rejected'],
  ] as const)('%i → %s', (status, kind) => {
    expect(classifyChatFailure(apiError(status)).kind).toBe(kind)
  })

  it('届かなかった（状態番号なし）：再試行できる接続の失敗なら一時的な不調', () => {
    expect(classifyChatFailure(apiError(undefined, { retryable: true })).kind).toBe('unavailable')
    expect(classifyChatFailure(apiError(undefined, { retryable: false })).kind).toBe('unknown')
  })

  it('提供元とは無関係の失敗・Error でないものは unknown', () => {
    expect(classifyChatFailure(new Error('x')).kind).toBe('unknown')
    expect(classifyChatFailure('just a string').kind).toBe('unknown')
    expect(classifyChatFailure(undefined).name).toBe('undefined')
  })
})

describe('再試行を開いて、最後の失敗と回数を読む', () => {
  it('2 回とも 503 → 種類は最後の失敗、回数は 2', () => {
    const retry = new RetryError({
      message: 'Failed after 2 attempts.',
      reason: 'maxRetriesExceeded',
      errors: [apiError(503, { retryable: true }), apiError(503, { retryable: true })],
    })
    const failure = classifyChatFailure(retry)
    expect(failure.kind).toBe('unavailable')
    expect(failure.attempts).toBe(2)
  })

  it('1 回目 503・2 回目 400（再試行できない）→ 最後の 400 で決める', () => {
    const retry = new RetryError({
      message: 'Failed after 2 attempts with non-retryable error',
      reason: 'errorNotRetryable',
      errors: [apiError(503, { retryable: true }), apiError(400)],
    })
    expect(classifyChatFailure(retry).kind).toBe('rejected')
  })
})

describe('提供元の状態名を読む（Google の本文）', () => {
  it('本文の error.status を読む', () => {
    const body =
      '{"error":{"code":503,"message":"The model is overloaded.","status":"UNAVAILABLE"}}'
    expect(classifyChatFailure(apiError(503, { body })).providerStatus).toBe('UNAVAILABLE')
  })

  it('本文が無い・JSON でない・形が違うなら null（落ちない）', () => {
    expect(classifyChatFailure(apiError(503)).providerStatus).toBeNull()
    expect(classifyChatFailure(apiError(503, { body: '<html>' })).providerStatus).toBeNull()
    expect(classifyChatFailure(apiError(503, { body: '{"error":"x"}' })).providerStatus).toBeNull()
  })
})

describe('こちらの打ち切りの残骸を、失敗と取り違えない', () => {
  it('打ち切ったあとの TimeoutError / AbortError だけが該当する', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(isOwnAbort(timeout, true)).toBe(true)
    expect(isOwnAbort(new DOMException('aborted', 'AbortError'), true)).toBe(true)
  })

  it('打ち切っていなければ、同じ形でも本物の失敗として扱う', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(isOwnAbort(timeout, false)).toBe(false)
  })

  it('打ち切っていても、提供元の失敗は失敗のまま', () => {
    expect(isOwnAbort(apiError(503), true)).toBe(false)
  })
})

describe('記録する失敗を選ぶ（1 つのターンでは同じものが何度も届く）', () => {
  const noOutput = new NoOutputGeneratedError({ message: 'No output generated.' })

  it('同じエラーは 1 回（onError と result.text の両方から届く）', () => {
    const error = apiError(503)
    expect(failuresToRecord([error, error], false)).toEqual([error])
  })

  it('「出力が無かった」は、他に失敗があればその結果にすぎないので除く（偽の API キーの実測）', () => {
    const cause = apiError(400)
    expect(failuresToRecord([cause, noOutput], false)).toEqual([cause])
  })

  it('「出力が無かった」しか無ければ、エラーなしに空で終わった異常として残す', () => {
    expect(failuresToRecord([noOutput], false)).toEqual([noOutput])
  })

  it('打ち切ったあとの TimeoutError は除く（ターンの 1 行が aborted として記録する）', () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(failuresToRecord([timeout], true)).toEqual([])
  })
})

describe('記録の 1 行', () => {
  const CONTEXT = { modelId: 'gemini-flash-lite-latest', elapsedMs: 31042, utterances: [] }

  it('種類・状態番号・状態名・回数・モデル・所要時間が 1 行に揃う', () => {
    const body = '{"error":{"code":503,"message":"overloaded","status":"UNAVAILABLE"}}'
    const line = chatFailureLogLine(classifyChatFailure(apiError(503, { body })), CONTEXT)
    expect(line).toBe(
      '[api/chat] model failure kind=unavailable status=503 provider=UNAVAILABLE attempts=1 ' +
        'model=gemini-flash-lite-latest elapsed=31042ms name=AI_APICallError detail="status 503"',
    )
    expect(line).not.toContain('\n')
  })

  it('説明は改行を畳み、160 文字で切る', () => {
    const long = new Error(`${'x'.repeat(100)}\n\n${'y'.repeat(200)}`)
    const line = chatFailureLogLine(classifyChatFailure(long), CONTEXT)
    const detail = z
      .string()
      .parse(JSON.parse(line.slice(line.indexOf('detail=') + 'detail='.length)))
    expect(detail.length).toBe(160)
    expect(detail).not.toContain('\n')
  })

  it('発話が紛れていたら伏せる。短すぎる発話（3 文字以下）は伏せない', () => {
    const failure = classifyChatFailure(new Error('rejected: 横浜市で中古マンション / 東京'))
    const line = chatFailureLogLine(failure, {
      ...CONTEXT,
      utterances: ['横浜市で中古マンション', '東京'],
    })
    expect(line).toContain('rejected: [発話] / 東京')
    expect(line).not.toContain('横浜市で中古マンション')
  })

  it('説明の中の引用符で 1 行が壊れない（JSON の文字列として出す）', () => {
    const line = chatFailureLogLine(classifyChatFailure(new Error('say "hi"')), CONTEXT)
    expect(line.endsWith('detail="say \\"hi\\""')).toBe(true)
  })
})
