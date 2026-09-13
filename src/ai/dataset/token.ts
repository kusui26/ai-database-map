/**
 * データセット URL の署名トークン（サーバ専用・`docs/260828_research_claude_auth.md` §5.3「短命の署名 URL」）。
 *
 * **何も保存しない**方式：URL は「署名済みのクエリ定義」で、GET のたびにライブの DB から
 * CSV を再生成する。Blob 等のストアを増やさず、値は常にアプリ・Layer 1 ツールと一致する
 * （§11 の「データ整合」を構造で満たす）。
 *
 * 署名・圧縮・鍵は `ai/signed-url.ts` と共有し（`render_map` も同じ土台を使う）、
 * ここが持つのは**何を載せるか**（payload の形）と期限の判定だけ。
 * exp（既定 24 時間）を過ぎたら 410——build_dataset を呼び直してもらう。
 */

import { z } from 'zod'
import {
  openPayload,
  signPayload,
  signedUrlSecret,
  SIGNED_URL_TTL_MS,
  type SignedUrlFailure,
  type SignedUrlToken,
} from '../signed-url'

/** URL の有効期間（24 時間＝分析セッション 1 回ぶん。恒久 API 化させない）。 */
export const DATASET_URL_TTL_MS = SIGNED_URL_TTL_MS

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
    /** 駅別ハザードサマリ（事前計算）を hazard_ 列として結合する（260903 PR-6）。 */
    hazard: z.boolean().optional(),
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

export type SignedDatasetToken = SignedUrlToken

/** クエリ定義に署名する（`now`・`secret` 注入で純粋にテスト可能）。 */
export function signDatasetToken(
  query: DatasetQuery,
  options: { readonly secret: string; readonly now: number; readonly ttlMs?: number },
): SignedDatasetToken {
  const expiresAtMs = options.now + (options.ttlMs ?? DATASET_URL_TTL_MS)
  return {
    token: signPayload({ v: 1, exp: expiresAtMs, q: query }, options.secret),
    expiresAtMs,
  }
}

export type DatasetTokenVerification =
  | { readonly ok: true; readonly query: DatasetQuery; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: SignedUrlFailure }

/** トークンを検証する（署名 → 展開 → 形 → 期限の順。失敗理由を区別して返す）。 */
export function verifyDatasetToken(
  token: string,
  options: { readonly secret: string; readonly now: number },
): DatasetTokenVerification {
  const opened = openPayload(token, options.secret)
  if (!opened.ok) return { ok: false, reason: opened.reason }
  const parsed = payloadSchema.safeParse(opened.payload)
  if (!parsed.success) return { ok: false, reason: 'malformed' }
  if (options.now >= parsed.data.exp) return { ok: false, reason: 'expired' }
  return { ok: true, query: parsed.data.q, expiresAtMs: parsed.data.exp }
}

/**
 * 署名の秘密鍵（`signed-url.ts` と同じ 1 本。名前は呼び出し側の読みやすさのため残す）。
 */
export function datasetSecret(): string {
  return signedUrlSecret()
}
