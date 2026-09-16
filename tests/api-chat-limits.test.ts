/**
 * `/api/chat` の上限が**どの IP で数えられているか**（`docs/260916_ops_guard.md` G3 の取り残し）。
 *
 * G3 で `clientIp` を `x-vercel-forwarded-for` 優先に直したとき、**chat だけが自前の複製を
 * 持っていて取り残されていた**（`x-real-ip` → `x-forwarded-for` のまま）。ハザード 4 本・
 * `/api/map`・`/api/mcp`・`/api/recommend` は共有版を使っていたので、**口によって IP の読み方が
 * 違う**状態だった。ここで共有版に寄せたことを、優先順位と鍵の独立性の両面から固定する。
 *
 * ⚠ **モデルには絶対に触らない。** 上限に掛からない側の確認は `GEMINI_API_KEY` を空にして
 * 503 で止める（`isChatConfigured()`）。「通り抜けた」の印として 503 を使う。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkRateLimit, resetRateLimitStore } from '@/ai/rate-limit'
import { POST as chat } from '@/app/api/chat/route'
import { GET as hazardPoint } from '@/app/api/hazard/point/route'

const WINDOW_MS = 60_000
/** どの上限よりも確実に多い回数（上限の値をテストに焼き込まないため）。 */
const OVER_ANY_LIMIT = 100
/** 上限を通り抜けた印（鍵が無いので、次の関門で必ずここに落ちる）。 */
const PASSED_THE_LIMIT = 503

/** その鍵の窓を埋める。 */
function saturate(key: string): void {
  for (let index = 0; index < OVER_ANY_LIMIT; index += 1) {
    checkRateLimit(key, { limit: 1000, windowMs: WINDOW_MS, now: Date.now() })
  }
}

function post(headers: Record<string, string>): Promise<Response> {
  return chat(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: '東京' }] }],
      }),
    }),
  )
}

beforeEach(() => {
  resetRateLimitStore()
  // モデルに届かせない。空文字は「未設定」として扱われる（`isChatConfigured`）。
  vi.stubEnv('GEMINI_API_KEY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('数えるのは Vercel が書くヘッダ', () => {
  it('`x-vercel-forwarded-for` が鍵になる（`x-real-ip` が違っても同じ相手）', async () => {
    saturate('chat:203.0.113.1')
    const response = await post({
      'x-vercel-forwarded-for': '203.0.113.1',
      'x-real-ip': '203.0.113.9',
    })
    expect(response.status).toBe(429)
  })

  it('`x-vercel-forwarded-for` が違えば別の相手（`x-real-ip` が同じでも）', async () => {
    // プロキシを挟むと `x-real-ip` 側が揃ってしまうことがある。そのとき**無関係な人を巻き込まない**。
    saturate('chat:203.0.113.1')
    const response = await post({
      'x-vercel-forwarded-for': '203.0.113.2',
      'x-real-ip': '203.0.113.1',
    })
    expect(response.status).toBe(PASSED_THE_LIMIT)
  })

  it('Vercel のヘッダが無ければ `x-real-ip`（ローカル・他の経路）', async () => {
    saturate('chat:203.0.113.3')
    expect((await post({ 'x-real-ip': '203.0.113.3' })).status).toBe(429)
  })
})

describe('止めるときの言い方', () => {
  it('429 と、待つ秒数を日本語で返す', async () => {
    saturate('chat:203.0.113.4')
    const response = await post({ 'x-real-ip': '203.0.113.4' })
    const body: unknown = await response.json()
    const text = JSON.stringify(body)
    expect(response.status).toBe(429)
    expect(text).toContain('RATE_LIMITED')
    expect(text).toContain('秒後に再試行してください')
  })
})

describe('制限はいちばん手前にある', () => {
  it('鍵の確認より先に 429（＝上限は何も起動させない）', async () => {
    saturate('chat:203.0.113.5')
    // 鍵は空にしてあるので、通り抜けていれば 503 になるはず。429 が返る＝手前で止めている。
    expect((await post({ 'x-real-ip': '203.0.113.5' })).status).toBe(429)
  })

  it('窓が空いていれば、いつもどおり次の関門へ進む', async () => {
    expect((await post({ 'x-real-ip': '203.0.113.6' })).status).toBe(PASSED_THE_LIMIT)
  })
})

/**
 * 鍵に `chat:` を付けた理由。`checkRateLimit` の store は**全ルート共通の 1 つの Map** なので、
 * 生の IP を鍵にしていると、次に誰かが同じ鍵で数えた瞬間にバケツを共有してしまう。
 */
describe('バケツは他のルートと相席にならない', () => {
  const ip = '203.0.113.7'
  const hazardQuery = 'http://localhost/api/hazard/point?placeJa=検証だけ'

  it('チャットを使い切っても、地図の続きは止まらない', async () => {
    saturate(`chat:${ip}`)
    expect((await post({ 'x-real-ip': ip })).status).toBe(429)
    // 座標が無いので 400（＝制限は通っている）。上流には行かない。
    const response = await hazardPoint(new Request(hazardQuery, { headers: { 'x-real-ip': ip } }))
    expect(response.status).toBe(400)
  })

  it('地図を使い切っても、チャットは止まらない', async () => {
    saturate(`hazard-point:${ip}`)
    expect((await post({ 'x-real-ip': ip })).status).toBe(PASSED_THE_LIMIT)
  })
})
