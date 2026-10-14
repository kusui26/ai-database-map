import { describe, expect, it } from 'vitest'
import { httpErrorJa, requestErrorJa } from '@/ai/eval/request-error'

/**
 * 評価の 1 問の失敗の言い方（`src/ai/eval/request-error.ts`・2026-10-14）。
 *
 * 1 問の例外で評価全体を止めず、理由を記録して次へ進む。その理由を、何が起きたか分かる 1 行にする
 * （打ち切り・サーバに届かない・読めない・サーバがエラーの状態で返した）。
 */

describe('requestErrorJa', () => {
  it('打ち切り（AbortSignal.timeout の TimeoutError・中断の AbortError）は秒で言う', () => {
    expect(requestErrorJa(new DOMException('timed out', 'TimeoutError'), 75_000)).toBe(
      '応答が 75 秒で打ち切られた',
    )
    expect(requestErrorJa(new DOMException('aborted', 'AbortError'), 3_000)).toBe(
      '応答が 3 秒で打ち切られた',
    )
  })

  it('サーバに届かない（fetch の cause の符号）', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3999'), {
      code: 'ECONNREFUSED',
    })
    expect(requestErrorJa(new TypeError('fetch failed', { cause }), 75_000)).toBe(
      'サーバに届かない（ECONNREFUSED）',
    )
  })

  it('そのほかの例外は名前と 1 行目（長ければ切る）', () => {
    expect(
      requestErrorJa(new SyntaxError('Unexpected token < in JSON\nat position 0'), 75_000),
    ).toBe('応答を読めない（SyntaxError: Unexpected token < in JSON）')
    const long = requestErrorJa(new Error('x'.repeat(500)), 75_000)
    expect(long.length).toBeLessThan(160)
    expect(requestErrorJa('壊れた', 75_000)).toBe('応答を読めない（壊れた）')
  })
})

describe('httpErrorJa', () => {
  it('チャットの入口のエラー（apiError の形）は状態と文を言う', () => {
    const body = {
      error: {
        code: 'RATE_LIMITED',
        message: 'リクエストが多すぎます。42秒後に再試行してください。',
      },
    }
    expect(httpErrorJa(429, body)).toBe(
      'サーバの応答がエラー（HTTP 429）：リクエストが多すぎます。42秒後に再試行してください。',
    )
  })

  it('文が読めなければ状態だけ（JSON でない・形が違う・文が無い）', () => {
    expect(httpErrorJa(500, null)).toBe('サーバの応答がエラー（HTTP 500）')
    expect(httpErrorJa(429, { error: 'rate_limited', retryAfterSeconds: 42 })).toBe(
      'サーバの応答がエラー（HTTP 429）',
    )
    expect(httpErrorJa(503, { error: { code: 'NOT_CONFIGURED' } })).toBe(
      'サーバの応答がエラー（HTTP 503）',
    )
  })

  it('文は 1 行目だけ・長ければ切る', () => {
    const long = httpErrorJa(400, { error: { message: `${'あ'.repeat(500)}\n2 行目` } })
    expect(long).toBe(`サーバの応答がエラー（HTTP 400）：${'あ'.repeat(120)}`)
  })
})
