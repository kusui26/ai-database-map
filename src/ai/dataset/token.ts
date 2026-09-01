/**
 * データセット URL の署名トークン（サーバ専用・`docs/260828_research_claude_auth.md` §5.3「短命の署名 URL」）。
 *
 * **何も保存しない**方式：URL は「署名済みのクエリ定義」で、GET のたびにライブの DB から
 * CSV を再生成する。Blob 等のストアを増やさず、値は常にアプリ・Layer 1 ツールと一致する
 * （§11 の「データ整合」を構造で満たす）。
 *
 * - 形式: `base64url(deflateRaw(JSON payload)) . base64url(HMAC-SHA256)`
 * - exp（既定 24 時間）を過ぎたら 410——build_dataset を呼び直してもらう
 * - 秘密鍵は `DATASET_URL_SECRET`（本番必須。サーバレスは水平スケールするため
 *   プロセス乱数では別インスタンスで検証できない）
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { z } from 'zod'

/** URL の有効期間（24 時間＝分析セッション 1 回ぶん。恒久 API 化させない）。 */
export const DATASET_URL_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 対象駅のセレクタ（`ListStationsFilter` と同形・listStations と同じ語彙）。
 * トークンには**正規化済み**の値だけを入れる（検証は署名時に済ませ、GET 側は信頼する）。
 */
export const datasetSelectorSchema = z.object({
  prefectures: z.array(z.string()).optional(),
  municipality: z.string().optional(),
  operators: z.array(z.string()).optional(),
  routes: z.array(z.string()).optional(),
  routeTypes: z.array(z.number().int()).optional(),
  bbox: z
    .object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() })
    .optional(),
  near: z.object({ lon: z.number(), lat: z.number(), radiusM: z.number() }).optional(),
  limit: z.number().int().optional(),
})
export type DatasetSelector = z.infer<typeof datasetSelectorSchema>

/** 署名対象のクエリ定義（grps か selector のどちらか一方）。 */
export const datasetQuerySchema = z
  .object({
    grps: z.array(z.string()).min(1).optional(),
    selector: datasetSelectorSchema.optional(),
    keys: z.array(z.string()).min(1),
    shape: z.enum(['wide', 'long']),
  })
  .refine((query) => (query.grps === undefined) !== (query.selector === undefined), {
    message: 'grps と selector はどちらか一方',
  })
export type DatasetQuery = z.infer<typeof datasetQuerySchema>

const payloadSchema = z.object({
  v: z.literal(1),
  exp: z.number().int(),
  q: datasetQuerySchema,
})

function signatureOf(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export type SignedDatasetToken = { readonly token: string; readonly expiresAtMs: number }

/** クエリ定義に署名する（`now`・`secret` 注入で純粋にテスト可能）。 */
export function signDatasetToken(
  query: DatasetQuery,
  options: { readonly secret: string; readonly now: number; readonly ttlMs?: number },
): SignedDatasetToken {
  const expiresAtMs = options.now + (options.ttlMs ?? DATASET_URL_TTL_MS)
  const payload = JSON.stringify({ v: 1, exp: expiresAtMs, q: query })
  const body = deflateRawSync(Buffer.from(payload, 'utf-8')).toString('base64url')
  return { token: `${body}.${signatureOf(options.secret, body)}`, expiresAtMs }
}

export type DatasetTokenVerification =
  | { readonly ok: true; readonly query: DatasetQuery; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: 'malformed' | 'signature' | 'expired' }

/** トークンを検証する（署名 → 展開 → 形 → 期限の順。失敗理由を区別して返す）。 */
export function verifyDatasetToken(
  token: string,
  options: { readonly secret: string; readonly now: number },
): DatasetTokenVerification {
  const at = token.lastIndexOf('.')
  if (at <= 0 || at === token.length - 1) return { ok: false, reason: 'malformed' }
  const body = token.slice(0, at)
  const given = Buffer.from(token.slice(at + 1), 'utf-8')
  const expected = Buffer.from(signatureOf(options.secret, body), 'utf-8')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'signature' }
  }
  try {
    const raw = inflateRawSync(Buffer.from(body, 'base64url')).toString('utf-8')
    const parsed = payloadSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return { ok: false, reason: 'malformed' }
    if (options.now >= parsed.data.exp) return { ok: false, reason: 'expired' }
    return { ok: true, query: parsed.data.q, expiresAtMs: parsed.data.exp }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

let warnedDevSecret = false

/**
 * 署名の秘密鍵。本番（NODE_ENV=production）では `DATASET_URL_SECRET` を必須にし、
 * 未設定なら**文脈つきで失敗**する（黙って弱い鍵で動かない）。開発は固定の代替値。
 */
export function datasetSecret(): string {
  const secret = process.env.DATASET_URL_SECRET
  if (secret !== undefined && secret.length > 0) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATASET_URL_SECRET が未設定です（build_dataset の署名 URL に必要）。' +
        '`openssl rand -hex 32` で生成し、環境変数（Vercel / .env）に設定してください。',
    )
  }
  if (!warnedDevSecret) {
    console.warn(
      '[dataset] DATASET_URL_SECRET 未設定のため開発用の固定鍵で署名します（本番では必須）',
    )
    warnedDevSecret = true
  }
  return 'aidb-dev-dataset-url-secret'
}
