/**
 * レート制限の鍵になる IP の取り方（`src/lib/http.ts` の `clientIp`）。
 *
 * **Vercel 上ではこの 3 つとも同じ値で、どれもプラットフォームが上書きする**ので、
 * 詐称の心配は無い。順番を決めてあるのは、**Vercel の上にさらにプロキシを置いたとき**に
 * `x-forwarded-for` だけが書き換わりうるため——書き換わらない方から順に見る。
 *
 * ⚠ ローカルではこの 3 つをクライアントが自由に送れる。**アプリ内の制限はローカルでは
 * 意味を持たない**（検査スクリプトはそれを利用して連射を切り離している）。
 */

import { describe, expect, it } from 'vitest'
import { clientIp } from '@/lib/http'

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/anything', { headers })
}

describe('優先順位', () => {
  it('Vercel 専用のヘッダが最優先（プロキシを挟んでも書き換わらない）', () => {
    expect(
      clientIp(
        request({
          'x-vercel-forwarded-for': '203.0.113.1',
          'x-real-ip': '203.0.113.2',
          'x-forwarded-for': '203.0.113.3',
        }),
      ),
    ).toBe('203.0.113.1')
  })

  it('無ければ x-real-ip', () => {
    expect(
      clientIp(request({ 'x-real-ip': '203.0.113.2', 'x-forwarded-for': '203.0.113.3' })),
    ).toBe('203.0.113.2')
  })

  it('最後に x-forwarded-for', () => {
    expect(clientIp(request({ 'x-forwarded-for': '203.0.113.3' }))).toBe('203.0.113.3')
  })
})

describe('値の読み方', () => {
  it('複数ホップは左端（最初のクライアント）を取る', () => {
    expect(
      clientIp(request({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' })),
    ).toBe('203.0.113.9')
  })

  it('空のヘッダは無いものとして次へ送る', () => {
    expect(clientIp(request({ 'x-vercel-forwarded-for': '', 'x-real-ip': '203.0.113.4' }))).toBe(
      '203.0.113.4',
    )
  })

  it('空白は落とす', () => {
    expect(clientIp(request({ 'x-real-ip': '  203.0.113.5  ' }))).toBe('203.0.113.5')
  })
})

describe('1 つも無いとき', () => {
  it('落ちずに既定の鍵を返す（全員が同じバケツに入る＝安全側）', () => {
    expect(clientIp(request({}))).toBe('unknown')
  })
})
