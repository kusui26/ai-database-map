/**
 * チャットのモデル呼び出しの失敗を**種類に分け、記録できる形にする**（サーバ専用・純関数）。
 *
 * ## なぜ要るか（2026-09-25 の障害から）
 *
 * Gemini が一時的に応答しなくなり、本番のチャットは 31 秒待って失敗した。ところがログには
 * 「失敗した」としか残っておらず、**429 なのか 5xx なのか接続の失敗なのかを後から確かめる手段が
 * 無かった**——ルートは失敗の中身を日本語の 1 文に丸め、元のエラーを捨てていたからである。
 *
 * ここでは SDK のエラーを開いて、**HTTP 状態・提供元の状態名・呼び出し回数**を取り出す。
 * 種類（`ChatFailureKind`）は画面に出す文を選ぶのに、残りはログに使う。
 *
 * ## SDK のエラーの形
 *
 * - `APICallError`：提供元が答えた（`statusCode` あり）か、届かなかった（無し・`isRetryable`）
 * - `RetryError`：再試行したうえで失敗した。中身は `errors`（全回）と `lastError`（最後）
 * - `FirstChunkTimeoutError`：こちらの fetch が初回応答を 15 秒で 2 回打ち切った（SDK は包まない）
 * - それ以外（ツールの形の不一致など）：種類は `unknown`
 */

import { APICallError, NoOutputGeneratedError, RetryError } from 'ai'
import { type ChatFailureKind } from '@/shared/chat-errors'
import { FirstChunkTimeoutError } from './client'

export interface ChatFailure {
  readonly kind: ChatFailureKind
  /** 提供元の HTTP 状態。届かなかった（接続の失敗）なら null。 */
  readonly status: number | null
  /** 提供元の状態名（Google の `error.status`＝`UNAVAILABLE` など）。読めなければ null。 */
  readonly providerStatus: string | null
  /** 呼び出した回数（SDK の再試行を含む）。 */
  readonly attempts: number
  readonly name: string
  /** 提供元の説明。**発話が紛れていることがある**ので、ログに出すときは伏せる（`chatFailureLogLine`）。 */
  readonly detail: string
}

const HTTP_REQUEST_TIMEOUT = 408
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_CLIENT_ERROR_MIN = 400
const HTTP_SERVER_ERROR_MIN = 500

/** 状態番号から種類を決める。**待てば直るか**で分ける。 */
function kindOf(status: number | null, retryable: boolean): ChatFailureKind {
  if (status === HTTP_TOO_MANY_REQUESTS) return 'rate_limited'
  if (status === HTTP_REQUEST_TIMEOUT) return 'unavailable'
  if (status === null) return retryable ? 'unavailable' : 'unknown' // 届かなかった＝接続の失敗
  if (status >= HTTP_SERVER_ERROR_MIN) return 'unavailable'
  return status >= HTTP_CLIENT_ERROR_MIN ? 'rejected' : 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Google の失敗本文 `{"error":{"code":503,"message":"…","status":"UNAVAILABLE"}}` から状態名を読む。 */
function providerStatusOf(responseBody: string | undefined): string | null {
  if (responseBody === undefined) return null
  try {
    const parsed: unknown = JSON.parse(responseBody)
    const status = isRecord(parsed) && isRecord(parsed.error) ? parsed.error.status : undefined
    return typeof status === 'string' ? status : null
  } catch {
    return null
  }
}

/** 失敗を開いて、種類と記録に要るものを取り出す（純関数）。 */
export function classifyChatFailure(error: unknown): ChatFailure {
  const attempts = RetryError.isInstance(error) ? error.errors.length : 1
  const cause = RetryError.isInstance(error) ? error.lastError : error
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode ?? null
    return {
      kind: kindOf(status, cause.isRetryable),
      status,
      providerStatus: providerStatusOf(cause.responseBody),
      attempts,
      name: cause.name,
      detail: cause.message,
    }
  }
  // 初回応答の打ち切り（`client.ts` の createTimedFetch が 2 回とも 15 秒で切った）。
  // 提供元が時間内に応答しなかった＝一時的な不調。打ち切り 1 回＋再試行 1 回で 2 回と数える。
  if (cause instanceof FirstChunkTimeoutError) {
    return {
      kind: 'unavailable',
      status: null,
      providerStatus: null,
      attempts: 2,
      name: cause.name,
      detail: cause.message,
    }
  }
  const name = cause instanceof Error ? cause.name : typeof cause
  const detail = cause instanceof Error ? cause.message : String(cause)
  return { kind: 'unknown', status: null, providerStatus: null, attempts, name, detail }
}

/**
 * こちらの打ち切り（`CHAT_TIMEOUT_MS`）の残骸か。打ち切ると `result.text` が `TimeoutError`
 * （`AbortSignal.timeout` の理由）で投げ返すが、これは提供元の失敗ではない——ターンの 1 行が
 * `aborted` として記録するので、失敗として重ねて記録しない。
 */
export function isOwnAbort(error: unknown, aborted: boolean): boolean {
  if (!aborted || !(error instanceof Error)) return false
  return error.name === 'AbortError' || error.name === 'TimeoutError'
}

/**
 * 記録する失敗を選ぶ（純関数）。1 つのターンの失敗は、同じものが何度も届く。
 *
 * - 同じエラーは 1 回にする（`onError` と `result.text` の両方から届く）
 * - こちらの打ち切りの残骸は除く（`isOwnAbort`）
 * - `NoOutputGeneratedError`（「出力が無かった」）は、**他に失敗があれば**その結果にすぎないので除く。
 *   実測（偽の API キー）では 400 の直後に必ず付いてきて、`kind=unknown` として並ぶと原因が 2 つに見えた。
 *   **それしか無い**ときは、エラーなしに空で終わった異常なので残す
 */
export function failuresToRecord(failures: readonly unknown[], aborted: boolean): unknown[] {
  const distinct = [...new Set(failures)].filter((failure) => !isOwnAbort(failure, aborted))
  const causes = distinct.filter((failure) => !NoOutputGeneratedError.isInstance(failure))
  return causes.length > 0 ? causes : distinct
}

/** 提供元の説明は長いことがある。1 行に収めて読める長さ。 */
const DETAIL_MAX_CHARS = 160
/**
 * これより短い発話は伏せない。1〜3 文字（「東京」「こんにちは」の一部）を伏せると、
 * 提供元の説明の単語まで消えて読めなくなる。この長さの断片は個人を特定しない。
 */
const MIN_CONCEALED_CHARS = 4
const CONCEALED = '[発話]'

/** 提供元の説明に発話が紛れていても、ログには残さない。 */
function conceal(text: string, utterances: readonly string[]): string {
  return utterances
    .filter((utterance) => utterance.length >= MIN_CONCEALED_CHARS)
    .reduce((masked, utterance) => masked.split(utterance).join(CONCEALED), text)
}

export interface FailureLogContext {
  readonly modelId: string
  readonly elapsedMs: number
  /** この会話の発話。ログに出る前に伏せる。 */
  readonly utterances: readonly string[]
}

/**
 * 失敗 1 件の記録（1 行）。**発話は出さない**——提供元の説明に紛れていても伏せる。
 *
 * 例：`[api/chat] model failure kind=unavailable status=503 provider=UNAVAILABLE attempts=2
 *      model=gemini-flash-lite-latest elapsed=31042ms name=AI_APICallError detail="The model is overloaded."`
 */
export function chatFailureLogLine(failure: ChatFailure, context: FailureLogContext): string {
  const detail = conceal(failure.detail, context.utterances)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DETAIL_MAX_CHARS)
  const fields = [
    `kind=${failure.kind}`,
    `status=${failure.status ?? '-'}`,
    `provider=${failure.providerStatus ?? '-'}`,
    `attempts=${failure.attempts}`,
    `model=${context.modelId}`,
    `elapsed=${context.elapsedMs}ms`,
    `name=${failure.name}`,
    `detail=${JSON.stringify(detail)}`,
  ]
  return ['[api/chat] model failure', ...fields].join(' ')
}
