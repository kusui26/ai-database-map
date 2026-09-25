/**
 * チャットの失敗を、画面が**どの 1 文で**言うか（`src/shared/chat-errors.ts`）。
 *
 * 2026-09-25 の障害で、画面は 429 以外のすべてを「応答の取得に失敗しました」で上書きしていた。
 * サーバは理由を言い分けていたのに、それが利用者に届いていなかった。
 * ここでは `useChat` が画面に渡す `Error` の 3 つの形——**ストリームのエラー文**・**HTTP の応答本文**・
 * **通信そのものの失敗**——について、選ばれる文を固定する。本文は実測した形をそのまま使う。
 */

import { describe, expect, it } from 'vitest'
import {
  CHAT_FAILURE_JA,
  CHAT_FAILURE_KINDS,
  CHAT_TRANSPORT_FAILURE_JA,
  chatErrorMessageJa,
} from '@/shared/chat-errors'
import { PLATFORM_BLOCKED_JA, platformMessageJa, platformStatusOf } from '@/shared/platform-error'

const ONLINE = true
const OFFLINE = false

describe('① サーバがストリームで送った文は、言い換えない', () => {
  it.each(CHAT_FAILURE_KINDS)('%s の文がそのまま出る', (kind) => {
    const sentence = CHAT_FAILURE_JA[kind]
    expect(chatErrorMessageJa(new Error(sentence), ONLINE)).toBe(sentence)
  })

  it('種類ごとの文はすべて違う（同じ文だと、画面から理由が見分けられない）', () => {
    const sentences = CHAT_FAILURE_KINDS.map((kind) => CHAT_FAILURE_JA[kind])
    expect(new Set(sentences).size).toBe(sentences.length)
  })

  it('「待てば直る」ものだけが「時間をおいて」と言う（設定の問題は直らないと言う）', () => {
    expect(CHAT_FAILURE_JA.rate_limited).toContain('時間をおいて')
    expect(CHAT_FAILURE_JA.unavailable).toContain('時間をおいて')
    expect(CHAT_FAILURE_JA.rejected).toContain('直らない可能性')
  })
})

describe('② HTTP が 2xx でなかった（SDK は応答本文をそのまま message に入れる）', () => {
  it('アプリの 429 は、待つ秒数まで含めてサーバの文を出す', () => {
    const body = JSON.stringify({
      error: {
        code: 'RATE_LIMITED',
        message: 'リクエストが多すぎます。37秒後に再試行してください。',
      },
    })
    expect(chatErrorMessageJa(new Error(body), ONLINE)).toBe(
      'リクエストが多すぎます。37秒後に再試行してください。',
    )
  })

  it('アプリの 503（鍵が未設定）も、サーバの文を出す', () => {
    const body = JSON.stringify({
      error: { code: 'NOT_CONFIGURED', message: 'チャットは未設定です（GEMINI_API_KEY）。' },
    })
    expect(chatErrorMessageJa(new Error(body), ONLINE)).toBe(
      'チャットは未設定です（GEMINI_API_KEY）。',
    )
  })

  it('WAF の遮断（本番で実測した本文）は「一時的に制限しています」と言い、Forbidden を出さない', () => {
    const body =
      '{"error":{"code":"403","message":"Forbidden","id":"hnd1::2z8j8-1790257960406-d619c6ead9e9"}}'
    const sentence = chatErrorMessageJa(new Error(body), ONLINE)
    expect(sentence).toBe(PLATFORM_BLOCKED_JA)
    expect(sentence).not.toContain('Forbidden')
  })

  it('WAF 以外の Vercel のエラーも、英語は出さない', () => {
    const body = JSON.stringify({ error: { code: '502', message: 'Bad Gateway', id: 'hnd1::abc' } })
    expect(chatErrorMessageJa(new Error(body), ONLINE)).toBe(CHAT_TRANSPORT_FAILURE_JA.unknown)
  })
})

describe('③ 通信そのものが失敗した', () => {
  it.each([
    ['Chromium', 'Failed to fetch'],
    ['Safari', 'Load failed'],
    ['Firefox', 'NetworkError when attempting to fetch resource.'],
  ])('%s（%s）：繋がっていれば「サーバに接続できませんでした」', (_browser, message) => {
    expect(chatErrorMessageJa(new TypeError(message), ONLINE)).toBe(
      CHAT_TRANSPORT_FAILURE_JA.unreachable,
    )
  })

  it('端末がオフラインと言っているときだけ「オフライン」と言う', () => {
    expect(chatErrorMessageJa(new TypeError('Failed to fetch'), OFFLINE)).toBe(
      CHAT_TRANSPORT_FAILURE_JA.offline,
    )
  })

  it('同じ文言でも TypeError でなければ通信断とは見なさない（取り違えない）', () => {
    expect(chatErrorMessageJa(new Error('Failed to fetch'), ONLINE)).toBe(
      CHAT_TRANSPORT_FAILURE_JA.unknown,
    )
  })
})

describe('④ どれでもない', () => {
  it('英語の見知らぬ文は、画面に出さない', () => {
    expect(chatErrorMessageJa(new Error('An error occurred.'), ONLINE)).toBe(
      CHAT_TRANSPORT_FAILURE_JA.unknown,
    )
  })
})

describe('Vercel の本文を見分ける（platform-error）', () => {
  it('3 桁の code と要求 ID があるものだけを Vercel とみなす', () => {
    expect(platformStatusOf({ error: { code: '403', message: 'Forbidden', id: 'hnd1::x' } })).toBe(
      403,
    )
    // アプリの封筒：code が語で、id が無い
    expect(platformStatusOf({ error: { code: 'RATE_LIMITED', message: '待って' } })).toBeNull()
    // 3 桁でも id が無ければアプリ側の形として扱う
    expect(platformStatusOf({ error: { code: '403', message: 'x' } })).toBeNull()
    expect(platformStatusOf('not an object')).toBeNull()
  })

  it('言い換えるのは遮断（403）だけ', () => {
    expect(platformMessageJa({ error: { code: '403', message: 'Forbidden', id: 'a::b' } })).toBe(
      PLATFORM_BLOCKED_JA,
    )
    expect(platformMessageJa({ error: { code: '500', message: 'x', id: 'a::b' } })).toBeNull()
  })

  it('遮断の文は、WAF の窓の上限（10 分）を超える約束をしない', () => {
    expect(PLATFORM_BLOCKED_JA).toContain('最大 10 分')
  })
})
