/**
 * チャットが失敗したとき**画面に出す 1 文**の語彙と、それを選ぶ純関数（サーバと画面で共有）。
 *
 * ## なぜ 1 か所に置くか（2026-09-25 の障害から）
 *
 * Gemini が一時的に応答しなくなったとき、利用者に見えたのは「応答の取得に失敗しました」だけだった。
 * サーバは「混雑しています」と「生成に失敗しました」を言い分けていたのに、**画面が 429 以外を
 * すべて自前の 1 文で上書きしていた**。さらにサーバ側の言い分けも、提供元の 500 のような
 * 一時的な不調を「生成に失敗」に落としていた——待てば直るのに、それが伝わらない。
 *
 * そこで**サーバが種類を決め、文はここで決め、画面はその文をそのまま出す**。
 * 画面が自分で文を選ぶのは、サーバの答えが届かなかったときだけに限る。
 */

import { errorEnvelopeSchema } from './api'
import { platformMessageJa, platformStatusOf } from './platform-error'

/** モデル呼び出しの失敗の種類。**待てば直るか**で分ける（直らないものに「時間をおいて」と言わない）。 */
export const CHAT_FAILURE_KINDS = ['rate_limited', 'unavailable', 'rejected', 'unknown'] as const
export type ChatFailureKind = (typeof CHAT_FAILURE_KINDS)[number]

/** モデル呼び出しが失敗したとき、サーバがストリームで送る 1 文（`errorText`）。 */
export const CHAT_FAILURE_JA: Readonly<Record<ChatFailureKind, string>> = {
  // 429。無料枠なので「上限の可能性」まで言える。
  rate_limited:
    'ただいま混雑しています（無料枠の上限の可能性があります）。少し時間をおいて再度お試しください。',
  // 5xx・408・接続失敗。提供元の一時的な不調で、待てば直る。
  unavailable: 'AI（Gemini）が一時的に応答できない状態です。少し時間をおいて再度お試しください。',
  // 429 以外の 4xx。鍵・モデル名・リクエストの形など**こちらの設定**の問題で、待っても直らない。
  rejected:
    'チャットの設定に問題があり、応答できませんでした。時間をおいても直らない可能性があります。',
  unknown: '応答の生成に失敗しました。時間をおいて再度お試しください。',
}

/** サーバの答えが届かなかったとき、画面が自分で選ぶ 1 文。 */
export const CHAT_TRANSPORT_FAILURE_JA = {
  // 端末が自分でオフラインと言っているときだけ（`docs/260916_ops_guard.md` G7）。
  offline: 'オフラインのため送信できませんでした。接続を確認してから、もう一度お試しください。',
  unreachable: 'サーバに接続できませんでした。時間をおいて再度お試しください。',
  unknown: '応答の取得に失敗しました。時間をおいて再度お試しください。',
} as const

const SERVER_SENTENCES: ReadonlySet<string> = new Set(Object.values(CHAT_FAILURE_JA))

/** 通信そのものの失敗。ブラウザごとに文言が違う（Chromium / Safari / Firefox）。 */
const NETWORK_FAILURE = /failed to fetch|load failed|networkerror|network error/i

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * HTTP が 2xx でなかったときの 1 文。SDK は**応答本文をそのまま** `error.message` に入れる。
 * Vercel（WAF）の本文はアプリの封筒と同じ形なので、**先に**見分ける（`platform-error.ts`）。
 */
function httpFailureJa(body: unknown): string | null {
  if (platformStatusOf(body) !== null) {
    return platformMessageJa(body) ?? CHAT_TRANSPORT_FAILURE_JA.unknown
  }
  const envelope = errorEnvelopeSchema.safeParse(body)
  return envelope.success ? envelope.data.error.message : null
}

/**
 * `useChat` の `error` から、画面に出す 1 文を選ぶ（純関数）。
 *
 * @param online `navigator.onLine`。「オフライン」と言ってよいのは、端末がそう言っているときだけ。
 */
export function chatErrorMessageJa(error: Error, online: boolean): string {
  // ① サーバがストリームで送った文 → 言い換えない
  if (SERVER_SENTENCES.has(error.message)) return error.message
  // ② HTTP が 2xx でなかった → サーバ（またはエッジ）の答えから選ぶ
  const httpJa = httpFailureJa(parseJson(error.message))
  if (httpJa !== null) return httpJa
  // ③ 通信そのものが失敗した
  if (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) {
    return online ? CHAT_TRANSPORT_FAILURE_JA.unreachable : CHAT_TRANSPORT_FAILURE_JA.offline
  }
  return CHAT_TRANSPORT_FAILURE_JA.unknown
}
