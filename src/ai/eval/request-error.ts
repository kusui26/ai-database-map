/**
 * 評価の 1 問の失敗の言い方（純関数・2026-10-14・`docs/261001_fix_user_feedback_ui.md` §6.22）。
 *
 * 1 問の例外で評価全体を止めない——理由を記録して次の問へ進む（`tests/chat-eval.test.ts`）。2026-10-13 は PC の
 * スリープ中にサーバの応答が止まり、目覚めたときの打ち切り（`TimeoutError`）が評価の外まで投げられて、62 問の評価が
 * 5 問目で止まった（報告のファイルも残らなかった）。
 */

/** 1 行に収める長さ（理由はレポートの表の 1 セルに入る）。 */
const MAX_DETAIL_CHARS = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 例外の名前（`TimeoutError` など・DOMException も Error も `name` を持つ）。 */
function nameOf(error: unknown): string | null {
  return isRecord(error) && typeof error.name === 'string' ? error.name : null
}

/** fetch が届かなかったときの理由の符号（undici は `cause.code` に `ECONNREFUSED` などを入れる）。 */
function causeCodeOf(error: unknown): string | null {
  if (!isRecord(error) || !isRecord(error.cause)) return null
  return typeof error.cause.code === 'string' ? error.cause.code : null
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, MAX_DETAIL_CHARS)
}

/** 1 問の失敗の理由（「応答が 75 秒で打ち切られた」「サーバに届かない（ECONNREFUSED）」）。 */
export function requestErrorJa(error: unknown, timeoutMs: number): string {
  const name = nameOf(error)
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `応答が ${timeoutMs / 1000} 秒で打ち切られた`
  }
  const code = causeCodeOf(error)
  if (code !== null) return `サーバに届かない（${code}）`
  if (error instanceof Error) return `応答を読めない（${error.name}: ${firstLine(error.message)}）`
  return `応答を読めない（${firstLine(String(error))}）`
}

/** サーバのエラーの本文（`apiError` の形 `{ error: { code, message } }`）の、人に向けた文。 */
function apiErrorMessageOf(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null
  return typeof body.error.message === 'string' ? body.error.message : null
}

/**
 * サーバがエラーの状態で返したときの理由（「サーバの応答がエラー（HTTP 429）：リクエストが多すぎます。…」）。
 * `body` は JSON として読めた本文（読めなければ null）。チャットの入口は、レート制限・鍵の未設定・入力の不正を
 * SSE ではなく JSON で返す——本文を読まないと、どの問も「パネルが出ない」としか残らない。
 */
export function httpErrorJa(status: number, body: unknown): string {
  const head = `サーバの応答がエラー（HTTP ${status}）`
  const message = apiErrorMessageOf(body)
  return message === null ? head : `${head}：${firstLine(message)}`
}
