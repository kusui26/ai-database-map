/**
 * 画面から共通API を叩く 1 か所（`docs/260916_ops_guard.md` G2）。
 *
 * 12 個のフックが**同じ 10 行**を書き写していた——タイムアウト付きの fetch、`!ok` なら
 * `new Error('…HTTP 429')`、Zod で検証。そこには 2 つの問題があった。
 *
 * ## ① 状態が文字列に埋まっていた
 *
 * `new Error('… (HTTP 429)')` では、**429 なのか 500 なのかを機械が判別できない**。
 * だから「4xx は叩き直さない」も「429 は待てば直ると伝える」も書けなかった。
 * `HttpError` が `status` を持てば、どちらも 1 行で書ける。
 *
 * ## ② サーバの日本語を捨てていた
 *
 * 共通API は「リクエストが多すぎます。約 19 秒待って再試行してください。」のように、
 * **人が読んで次の一手が分かる日本語**を返している。それを握り潰して
 * 「取得できませんでした」に丸めると、待てば直ることが伝わらない。
 */

import { errorEnvelopeSchema } from '@/shared/api'
import { platformMessageJa, platformStatusOf } from '@/shared/platform-error'

/** 共通API の失敗（状態番号を持つ）。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * 叩き直しても結果が変わらない失敗か。
 *
 * 400 は条件を直さない限り何度でも 400 で、**429 は叩き直すこと自体が原因**——
 * 「待ってください」と表示しながら裏で再試行するのは、自分の待ち時間を自分で延ばしている。
 */
export function isClientError(error: unknown): boolean {
  return error instanceof HttpError && error.status >= 400 && error.status < 500
}

/**
 * 画面に出す 1 文。**サーバが日本語を返していればそれを使う**（言い換えない）。
 * サーバ以外の失敗（通信断・タイムアウト）は、呼び出し側が用意した文に倒す。
 */
export function messageJaOf(error: unknown, fallbackJa: string): string {
  return error instanceof HttpError ? error.message : fallbackJa
}

/**
 * 共通API のエラー封筒から日本語を取り出す。形が違えば null。
 *
 * ⚠ **Vercel（WAF）の本文は封筒と同じ形をしている**（`{"error":{"code":"403","message":"Forbidden",…}}`）。
 * 先に見分けないと、遮断されたときに英語の `Forbidden` を「サーバの日本語」として画面に出してしまう
 * （2026-09-24 に WAF を `Deny` にしてから開いていた穴・`shared/platform-error.ts`）。
 */
function serverMessageJa(body: unknown): string | null {
  if (platformStatusOf(body) !== null) return platformMessageJa(body)
  const parsed = errorEnvelopeSchema.safeParse(body)
  return parsed.success ? parsed.data.error.message : null
}

export type FetchJsonOptions = {
  readonly timeoutMs: number
  /** サーバが日本語を返さなかったときの 1 文（例「路線を取得できませんでした」）。 */
  readonly fallbackJa: string
}

/**
 * 取得して検証する。失敗は必ず `HttpError`（状態番号つき）で投げる。
 *
 * `schema` は Zod をそのまま渡せる（`parse` をメソッドとして呼ぶので `this` が外れない）。
 */
export async function fetchJson<T>(
  url: string,
  schema: { readonly parse: (value: unknown) => T },
  options: FetchJsonOptions,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    // 本文が JSON でないこと（502 の HTML など）もあるので、失敗しても止めない。
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const messageJa = serverMessageJa(body) ?? `${options.fallbackJa}（HTTP ${response.status}）`
      throw new HttpError(response.status, messageJa)
    }
    return schema.parse(body)
  } finally {
    clearTimeout(timer)
  }
}
