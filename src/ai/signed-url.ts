/**
 * 署名つき短命 URL の土台（サーバ専用）。
 *
 * `docs/260828_research_claude_auth.md` §5.3 で `build_dataset` が始めた**「何も保存しない」方式**
 * ——URL 自体が署名済みの定義で、GET のたびに中身を作り直す——を、`render_map`（PR-13）と
 * 共有するために切り出した。保存先（Blob 等）を増やさないので、返す中身は常にライブの値と一致する。
 *
 * ここが持つのは**署名・圧縮・鍵**だけ。何を載せるか（payload の形）と期限の判定は、
 * 用途ごとのモジュール（`dataset/token.ts`・`map-report/token.ts`）が Zod で持つ——
 * 形が違えば他方のトークンは検証に落ちるので、URL の使い回しも自然に防がれる。
 *
 * - 形式: `base64url(deflateRaw(JSON payload)) . base64url(HMAC-SHA256)`
 * - 鍵は `DATASET_URL_SECRET`（本番必須。サーバレスは水平スケールするので、
 *   プロセス乱数だと別インスタンスで検証できない）
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

/** URL の有効期間（24 時間＝分析セッション 1 回ぶん。恒久 API 化させない）。 */
export const SIGNED_URL_TTL_MS = 24 * 60 * 60 * 1000

/** 署名済みトークンと、その期限。 */
export type SignedUrlToken = { readonly token: string; readonly expiresAtMs: number }

/** 検証の失敗理由（呼び出し側が「次の一手」を言い分けるために区別する）。 */
export type SignedUrlFailure = 'malformed' | 'signature' | 'expired'

function signatureOf(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/** payload を圧縮して署名する。 */
export function signPayload(payload: unknown, secret: string): string {
  const body = deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf-8')).toString('base64url')
  return `${body}.${signatureOf(secret, body)}`
}

/**
 * 署名を確かめて payload を取り出す（**形の検証は呼び出し側の Zod**）。
 * 署名 → 展開 → JSON の順で、どこで落ちたかを `malformed` / `signature` に分ける。
 */
export function openPayload(
  token: string,
  secret: string,
):
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: 'malformed' | 'signature' } {
  const at = token.lastIndexOf('.')
  if (at <= 0 || at === token.length - 1) return { ok: false, reason: 'malformed' }
  const body = token.slice(0, at)
  const given = Buffer.from(token.slice(at + 1), 'utf-8')
  const expected = Buffer.from(signatureOf(secret, body), 'utf-8')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'signature' }
  }
  try {
    const raw = inflateRawSync(Buffer.from(body, 'base64url')).toString('utf-8')
    return { ok: true, payload: JSON.parse(raw) }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

let warnedDevSecret = false

/**
 * 署名の秘密鍵。本番（NODE_ENV=production）では `DATASET_URL_SECRET` を必須にし、
 * 未設定なら**文脈つきで失敗**する（黙って弱い鍵で動かない）。開発は固定の代替値。
 *
 * 環境変数名が `DATASET_` のままなのは、既に本番へ設定済みで、用途が増えるたびに
 * 鍵を増やすと運用の手間だけが増えるため（署名 URL 全体で 1 本）。
 */
export function signedUrlSecret(): string {
  const secret = process.env.DATASET_URL_SECRET
  if (secret !== undefined && secret.length > 0) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATASET_URL_SECRET が未設定です（build_dataset / render_map の署名 URL に必要）。' +
        '`openssl rand -hex 32` で生成し、環境変数（Vercel / .env）に設定してください。',
    )
  }
  if (!warnedDevSecret) {
    console.warn(
      '[signed-url] DATASET_URL_SECRET 未設定のため開発用の固定鍵で署名します（本番では必須）',
    )
    warnedDevSecret = true
  }
  return 'aidb-dev-dataset-url-secret'
}
