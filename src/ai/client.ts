/**
 * LLM プロバイダ抽象（Step2・サーバ専用）。
 *
 * 既定は Google Gemini（Flash 系・architecture.md §10.2）。モデルは env で差し替え可能にし、
 * ツール表面（＝共通API）に依存を寄せる（プロバイダは差し替え可能な実装詳細）。
 * 鍵はサーバのみ（`GEMINI_API_KEY`）。UI からは参照しない。
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { type LanguageModel } from 'ai'

/**
 * 既定モデル（Gemini Flash-Lite・architecture.md §10.2/§10.7）。env `GEMINI_MODEL` で上書き可能。
 *
 * 無料枠で実用になるのは 3.x の Flash-Lite（Flash 系や 2.5 Flash-Lite は 20 回/日・
 * docs/feat_llm.md §6.1）。2026-09-26 の eval で 38/38（災害・拒否 17/17）。
 *
 * **番号つきの版に固定する**（`-latest` の別名にしない）。別名は断りなく中身が替わり
 * （2026-09 に `gemini-flash-lite-latest` が 3.1 → 3.5 に替わっていた）、替わってもエラーは出ない。
 * 固定した版が退役すれば 404 になり、`model failure … status=404` の 1 行で分かる。
 * 上げるときは eval を流してから（docs/260926_chat_model_eval.md）。
 *
 * ID が `gemini-3…` だと `@ai-sdk/google` が Gemini 3 として扱い、並列のツール呼び出しの 2 つ目以降
 * （署名が付かないのが仕様）に目印を補う。そのたびに出る `AI SDK Warning … without a
 * thoughtSignature` は無害（同 §4.4）。
 */
export const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash-lite'

/** ツールループの最大ステップ数（検索→詳細→…の多段呼び出し上限・plan_fable P8a）。 */
export const MAX_TOOL_STEPS = 6

/**
 * 生成の温度。**送らない**（`undefined`）＝モデルの既定（Gemini 3 系は 1.0）。
 *
 * Google は Gemini 3 系で既定のままを強く推奨している（1.0 未満は「ループや性能低下を招きうる」）。
 * 以前は 0.2 を渡していたが、2026-09-26 の eval で既定でも 38/38 と変わらず、同じ時間帯に交互に
 * 投げても速さ・長さに差がなかったので、推奨に従う（docs/260926_chat_model_eval.md）。
 * 変えるなら eval を流してから。
 */
export const CHAT_TEMPERATURE: number | undefined = undefined

/**
 * 1 リクエストの上限時間（ミリ秒・アプリ側 AbortSignal）。
 *
 * Vercel 関数上限 60s（`maxDuration`）の内側に **10 秒のマージン**を残して 50s とする。
 * コールドスタート＋ツール実行＋モデル往復＋初回応答の再試行を積んでも収まる想定
 * （docs/260728_chat_scatter_plot_timeout_mitigation.md §8 の決定 3）。
 */
export const CHAT_TIMEOUT_MS = 50_000

/**
 * モデルの**初回応答（最初のチャンク）**までの上限（ミリ秒）。
 *
 * 実測では正常時 ~1s に対しテールで 7.1 / 10.8 / 29.9s の停滞があり、呼び出し回数が多いほど
 * 45s 到達の確率が上がっていた（同 §2.2）。ここで打ち切って**1 回だけ即再試行**することで、
 * 長い停滞を「15s ＋ 通常の再試行」に置き換える。ストリーム開始後は打ち切らない。
 */
export const TIME_TO_FIRST_CHUNK_MS = 15_000

/** これを超えた初回応答は遅延として 1 行ログに残す（本番での再発検知）。 */
const SLOW_RESPONSE_LOG_MS = 8_000

/** ユーザー入力（最新発話）の最大文字数。plan_fable P8a の 500 文字上限。 */
export const MAX_INPUT_CHARS = 500

/** 採用モデル ID（env 優先・未指定なら既定）。 */
export function chatModelId(): string {
  const fromEnv = process.env.GEMINI_MODEL
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : DEFAULT_CHAT_MODEL
}

/** API キーが設定済みか（未設定なら /api/chat は 503 を返す）。 */
export function isChatConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY
  return key !== undefined && key.length > 0
}

/**
 * 初回チャンク待ちの打ち切り（再試行してよい失敗かを型で判別するための専用エラー）。
 *
 * 2 回とも打ち切ると、このエラーがそのまま SDK を抜けてくる（`APICallError` ではないので SDK は
 * 再試行せず、`handleFetchError` も包まない）。**提供元が時間内に応答しなかった**という意味なので、
 * 分類では一時的な不調として扱う（`chat-errors.ts`）——2026-09-25 の障害の「31 秒」はこれだった。
 */
export class FirstChunkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`モデルの初回応答が ${timeoutMs}ms 以内に得られませんでした`)
    this.name = 'FirstChunkTimeoutError'
  }
}

/** 先読みした 1 チャンクを先頭に戻したストリーム（消費済みチャンクを失わない）。 */
function restream(
  first: ReadableStreamReadResult<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      if (first.done) {
        controller.close()
        return
      }
      if (first.value !== undefined) controller.enqueue(first.value)
    },
    pull: async (controller) => {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      if (value !== undefined) controller.enqueue(value)
    },
    cancel: (reason) => {
      void reader.cancel(reason)
    },
  })
}

/** 遅い初回応答を 1 行だけ記録する（鍵・URL は出さない）。 */
function logIfSlow(elapsedMs: number): void {
  if (elapsedMs < SLOW_RESPONSE_LOG_MS) return
  console.warn(`[ai] モデルの初回応答に ${elapsedMs}ms（テール遅延）`)
}

/** 1 回分の呼び出し（初回チャンクまでに期限を設け、以降のストリームは切らない）。 */
async function fetchOnce(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const outer = init?.signal
  if (outer !== null && outer !== undefined && outer.aborted) throw outer.reason
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort(outer?.reason)
  outer?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new FirstChunkTimeoutError(timeoutMs)), timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const body = response.body
    if (body === null) return response
    const reader = body.getReader()
    const first = await reader.read()
    logIfSlow(Date.now() - startedAt)
    return new Response(restream(first, reader), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', forwardAbort)
  }
}

/** ボディを再送してよいか（文字列・未設定のみ安全に再試行できる）。 */
function isReplayable(init: RequestInit | undefined): boolean {
  const body = init?.body
  return body === undefined || body === null || typeof body === 'string'
}

/**
 * 初回応答が遅すぎる呼び出しを打ち切り、**1 回だけ**即再試行する fetch。
 * プロバイダに注入して、テール遅延（実測 30s 級）が 1 ターンを潰すのを防ぐ。
 */
export function createTimedFetch(
  timeoutMs: number = TIME_TO_FIRST_CHUNK_MS,
): typeof globalThis.fetch {
  return async (input, init) => {
    try {
      return await fetchOnce(input, init, timeoutMs)
    } catch (error) {
      const retryable =
        error instanceof FirstChunkTimeoutError &&
        init?.signal?.aborted !== true &&
        isReplayable(init)
      if (!retryable) throw error
      console.warn(`[ai] 初回応答が ${timeoutMs}ms を超えたため 1 回だけ再試行します`)
      return await fetchOnce(input, init, timeoutMs)
    }
  }
}

/**
 * チャット用の言語モデルを構築する（Gemini・鍵はサーバ env のみ）。
 * `@ai-sdk/google` の既定 env は `GOOGLE_GENERATIVE_AI_API_KEY` のため、本プロジェクトの
 * `GEMINI_API_KEY` を明示注入する（.env.example 参照）。
 * fetch は初回応答の期限つき（`createTimedFetch`）。
 */
export function chatModel(): LanguageModel {
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('GEMINI_API_KEY が未設定です（.env に設定してください）')
  }
  const provider = createGoogleGenerativeAI({ apiKey, fetch: createTimedFetch() })
  return provider(chatModelId())
}
