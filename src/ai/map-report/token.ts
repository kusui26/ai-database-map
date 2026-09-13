/**
 * 地図レポート URL の署名トークン（サーバ専用・PR-13）。
 *
 * 載せるのは**描画の指示（`MapAction[]`）そのもの**で、描いた HTML ではない。
 * GET のたびにサーバが grp を座標へ解決し、キキクルの時刻を取り直して描くので、
 * **開くたびに最新の面**になる（`build_dataset` と同じ「何も保存しない」方式）。
 *
 * 署名・圧縮・鍵は `ai/signed-url.ts` と共有する。payload の形が違うので、
 * データセットの URL を地図の入口に投げても検証に落ちる。
 */

import { z } from 'zod'
import {
  openPayload,
  signPayload,
  SIGNED_URL_TTL_MS,
  type SignedUrlFailure,
  type SignedUrlToken,
} from '../signed-url'
import { mapActionSchema } from '@/shared/protocol'

/** URL の有効期間（データセットと同じ 24 時間）。 */
export const MAP_URL_TTL_MS = SIGNED_URL_TTL_MS

/** 受け取る地図操作の上限（§4.3(b)）。1 回の応答ぶんを想定した数。 */
export const MAP_MAX_ACTIONS = 20
/** 行き先（`highlightPoints`）の合計上限。 */
export const MAP_MAX_POINTS = 50
/** 一覧の駅（`highlightStations`）の合計上限。 */
export const MAP_MAX_GRPS = 200

/** 合計の数を数える（超過は「何が多いか」を言って弾く）。 */
function countTotals(actions: readonly z.infer<typeof mapActionSchema>[]): {
  readonly points: number
  readonly grps: number
} {
  return actions.reduce(
    (totals, action) => ({
      points: totals.points + (action.type === 'highlightPoints' ? action.points.length : 0),
      grps: totals.grps + (action.type === 'highlightStations' ? action.grps.length : 0),
    }),
    { points: 0, grps: 0 },
  )
}

/**
 * 地図レポートの定義。`mapActions` は**ツール結果の `structuredContent.mapActions` をそのまま**
 * 渡す前提なので、型は protocol のものを再利用する（語彙を二重に持たない）。
 */
export const mapQuerySchema = z
  .object({
    actions: z.array(mapActionSchema).min(1).max(MAP_MAX_ACTIONS),
    title: z.string().min(1).max(160).optional(),
  })
  .superRefine((query, ctx) => {
    const totals = countTotals(query.actions)
    if (totals.points > MAP_MAX_POINTS) {
      ctx.addIssue({
        code: 'custom',
        message: `highlightPoints の点が多すぎます（${totals.points} > ${MAP_MAX_POINTS}）。絞ってから渡してください。`,
      })
    }
    if (totals.grps > MAP_MAX_GRPS) {
      ctx.addIssue({
        code: 'custom',
        message: `highlightStations の駅が多すぎます（${totals.grps} > ${MAP_MAX_GRPS}）。上位だけに絞ってください。`,
      })
    }
  })
export type MapQuery = z.infer<typeof mapQuerySchema>

const payloadSchema = z.object({
  v: z.literal(1),
  exp: z.number().int(),
  /** データセットの payload（`q`）と**別のキー**にしてある（URL の取り違えが検証で落ちる）。 */
  m: mapQuerySchema,
})

/** 地図の定義に署名する（`now`・`secret` 注入で純粋にテスト可能）。 */
export function signMapToken(
  query: MapQuery,
  options: { readonly secret: string; readonly now: number; readonly ttlMs?: number },
): SignedUrlToken {
  const expiresAtMs = options.now + (options.ttlMs ?? MAP_URL_TTL_MS)
  return { token: signPayload({ v: 1, exp: expiresAtMs, m: query }, options.secret), expiresAtMs }
}

export type MapTokenVerification =
  | { readonly ok: true; readonly query: MapQuery; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: SignedUrlFailure }

/** トークンを検証する（署名 → 形 → 期限。失敗理由を区別して返す）。 */
export function verifyMapToken(
  token: string,
  options: { readonly secret: string; readonly now: number },
): MapTokenVerification {
  const opened = openPayload(token, options.secret)
  if (!opened.ok) return { ok: false, reason: opened.reason }
  const parsed = payloadSchema.safeParse(opened.payload)
  if (!parsed.success) return { ok: false, reason: 'malformed' }
  if (options.now >= parsed.data.exp) return { ok: false, reason: 'expired' }
  return { ok: true, query: parsed.data.m, expiresAtMs: parsed.data.exp }
}
