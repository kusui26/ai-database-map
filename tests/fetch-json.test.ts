/**
 * 画面から共通API を叩く 1 か所（`src/lib/fetch-json.ts`・260916 G2）。
 *
 * ここが決めるのは 2 つ。**失敗の種類が機械に分かること**（`status` を文字列に埋めない）と、
 * **サーバの日本語を捨てないこと**。どちらも、これまで 12 個のフックが**それぞれ**落としていた。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { fetchJson, HttpError, isClientError, messageJaOf } from '@/lib/fetch-json'

const schema = z.object({ ok: z.literal(true) })
const OPTIONS = { timeoutMs: 1000, fallbackJa: 'データを取得できませんでした' }

/** 応答を差し替える（本文は文字列で渡し、JSON でない場合も作れるように）。 */
function stubFetch(status: number, body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('成功したとき', () => {
  it('スキーマで検証して返す', async () => {
    stubFetch(200, JSON.stringify({ ok: true }))
    await expect(fetchJson('/api/x', schema, OPTIONS)).resolves.toEqual({ ok: true })
  })

  it('形が違えば検証で落ちる（黙って通さない）', async () => {
    stubFetch(200, JSON.stringify({ ok: 'yes' }))
    await expect(fetchJson('/api/x', schema, OPTIONS)).rejects.toThrow()
  })
})

describe('失敗したとき：状態番号を持たせる', () => {
  it('HttpError に status が載る（文字列に埋めない）', async () => {
    stubFetch(429, JSON.stringify({ error: { code: 'RATE_LIMITED', message: '待ってください' } }))
    await expect(fetchJson('/api/x', schema, OPTIONS)).rejects.toBeInstanceOf(HttpError)
    stubFetch(429, JSON.stringify({ error: { code: 'RATE_LIMITED', message: '待ってください' } }))
    const error = await fetchJson('/api/x', schema, OPTIONS).catch((e: unknown) => e)
    expect(error instanceof HttpError && error.status).toBe(429)
  })
})

describe('失敗したとき：サーバの日本語を捨てない', () => {
  it('エラー封筒があれば、その文をそのまま使う', async () => {
    const messageJa = 'リクエストが多すぎます。約 19 秒待って再試行してください。'
    stubFetch(429, JSON.stringify({ error: { code: 'RATE_LIMITED', message: messageJa } }))
    const error = await fetchJson('/api/x', schema, OPTIONS).catch((e: unknown) => e)
    expect(error instanceof Error && error.message).toBe(messageJa)
  })

  it('封筒でなければ、呼び出し側の 1 文に状態番号を添える', async () => {
    stubFetch(502, '<html>Bad Gateway</html>')
    const error = await fetchJson('/api/x', schema, OPTIONS).catch((e: unknown) => e)
    expect(error instanceof Error && error.message).toBe('データを取得できませんでした（HTTP 502）')
  })

  it('本文が JSON でなくても、そこで止まらない', async () => {
    stubFetch(500, 'not json at all')
    await expect(fetchJson('/api/x', schema, OPTIONS)).rejects.toBeInstanceOf(HttpError)
  })
})

describe('叩き直してよい失敗か', () => {
  it('4xx は叩き直さない（400 は同じ結果・429 は叩くこと自体が原因）', () => {
    expect(isClientError(new HttpError(400, 'x'))).toBe(true)
    expect(isClientError(new HttpError(429, 'x'))).toBe(true)
    expect(isClientError(new HttpError(404, 'x'))).toBe(true)
  })

  it('5xx と通信断は叩き直してよい', () => {
    expect(isClientError(new HttpError(500, 'x'))).toBe(false)
    expect(isClientError(new HttpError(502, 'x'))).toBe(false)
    expect(isClientError(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('境界：399 と 500 は 4xx ではない', () => {
    expect(isClientError(new HttpError(399, 'x'))).toBe(false)
    expect(isClientError(new HttpError(500, 'x'))).toBe(false)
  })
})

describe('画面に出す 1 文', () => {
  it('サーバが言っていれば、その言葉を使う（言い換えない）', () => {
    expect(messageJaOf(new HttpError(429, '約 19 秒待ってください'), '既定')).toBe(
      '約 19 秒待ってください',
    )
  })

  it('サーバ以外の失敗は、呼び出し側の 1 文に倒す', () => {
    expect(messageJaOf(new TypeError('Failed to fetch'), '既定')).toBe('既定')
    expect(messageJaOf(undefined, '既定')).toBe('既定')
  })
})
