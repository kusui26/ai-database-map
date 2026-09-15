/**
 * `/api/recommend` の入口の実測（`docs/260912_gui_chat_protocol.md` §13.7 W3 の受け入れ）。
 *
 * ここで見るのは **DB へ行く前に止まる経路**——400（入力不正）と 429（レート制限）。
 * どちらもハンドラの先頭で決まるので、Supabase の鍵が無くても本物のルートを呼んで確かめられる。
 * 正常系は DB が要るので `tests/api.smoke.sh`（実サーバ）の担当。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/recommend/route'
import { resetRateLimitStore } from '@/ai/rate-limit'

const BASE = 'http://localhost/api/recommend'

function call(queryString: string, ip = '10.0.0.1'): Promise<Response> {
  return GET(new Request(`${BASE}?${queryString}`, { headers: { 'x-real-ip': ip } }))
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('error' in body) ||
    typeof body.error !== 'object' ||
    body.error === null ||
    !('code' in body.error) ||
    !('message' in body.error)
  ) {
    throw new Error(`エラー封筒ではありません: ${JSON.stringify(body)}`)
  }
  return { code: String(body.error.code), message: String(body.error.message) }
}

beforeEach(() => {
  resetRateLimitStore()
})

describe('400：DB に行く前に止まる', () => {
  it('絞り込みが無ければ 400（全国を対象にしない）', async () => {
    const response = await call('')
    expect(response.status).toBe(400)
    const error = await errorOf(response)
    expect(error.code).toBe('BAD_REQUEST')
    expect(error.message).toContain('絞り込')
  })

  it('半径が 6 段以外なら 400', async () => {
    const response = await call('municipality=横浜市&radiusM=1234')
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toContain('半径')
  })

  it('重みの形が違えば 400', async () => {
    const response = await call('municipality=横浜市&weights=pop_gr')
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toContain('weights')
  })

  it('知らない指標名なら 400（黙って既定で計算しない）', async () => {
    const response = await call('municipality=横浜市&weights=nope:1')
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toContain('nope')
  })

  it('知らない正規化の方法なら 400', async () => {
    expect((await call('municipality=横浜市&method=magic')).status).toBe(400)
  })

  it('エラーはキャッシュさせない', async () => {
    const response = await call('')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('429：1 分あたりの上限', () => {
  it('上限を超えると 429 と Retry-After が返る', async () => {
    const ip = '10.0.0.2'
    const before = await Promise.all(Array.from({ length: 30 }, () => call('', ip)))
    expect(before.every((response) => response.status === 400)).toBe(true)

    const limited = await call('', ip)
    expect(limited.status).toBe(429)
    const error = await errorOf(limited)
    expect(error.code).toBe('RATE_LIMITED')
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('制限は IP ごと（他の利用者を巻き込まない）', async () => {
    await Promise.all(Array.from({ length: 31 }, () => call('', '10.0.0.3')))
    expect((await call('', '10.0.0.4')).status).toBe(400)
  })
})
