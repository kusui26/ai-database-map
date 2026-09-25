/**
 * Vercel（エッジ・WAF）が返したエラーを、アプリのエラー封筒と**見分ける**。
 *
 * WAF の遮断（`docs/260916_ops_guard.md` §8.4）は 403 で、本文はこうなる（2026-09-24 実測）：
 *
 * ```json
 * {"error":{"code":"403","message":"Forbidden","id":"hnd1::2z8j8-1790257960406-d619c6ead9e9"}}
 * ```
 *
 * これは**アプリのエラー封筒 `{"error":{"code","message"}}` と同じ形**をしている。見分けないと
 * 「サーバの日本語をそのまま出す」経路（G2・チャット）が、英語の `Forbidden` を画面に出してしまう。
 * 違いは 2 つある——`code` が **3 桁の数字**であること（アプリは `RATE_LIMITED` のような語）と、
 * `id` に**リージョン付きの要求 ID**（`hnd1::…`）が付くこと（アプリの封筒には無い）。
 */

import { z } from 'zod'

const platformEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().regex(/^\d{3}$/),
    message: z.string(),
    id: z.string().regex(/::/),
  }),
})

/** WAF の窓は最大 10 分（Vercel の上限・Pro も同じ）。遮断はそれより長くは続かない。 */
export const PLATFORM_BLOCKED_JA =
  'アクセスが集中したため、一時的に制限しています。最大 10 分ほどおいてから、もう一度お試しください。'

/** Vercel が返したエラーなら、その状態番号。アプリの封筒・形の違う本文なら null。 */
export function platformStatusOf(body: unknown): number | null {
  const parsed = platformEnvelopeSchema.safeParse(body)
  return parsed.success ? Number(parsed.data.error.code) : null
}

/**
 * Vercel のエラーを、画面に出す 1 文にする。**言えることがあるのは遮断（403）だけ**で、
 * それ以外は null を返し、呼び出し側の文に任せる——英語の `message` は決して出さない。
 */
export function platformMessageJa(body: unknown): string | null {
  return platformStatusOf(body) === 403 ? PLATFORM_BLOCKED_JA : null
}
