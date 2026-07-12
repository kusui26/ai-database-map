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
 * 既定モデル（Gemini Flash 系・architecture.md §10.2/§10.7）。env `GEMINI_MODEL` で上書き可能。
 *
 * 2026-07 の無料枠実測（docs/p8c_eval_report.md §2）で、`gemini-2.5-flash` は新規非対応（404）、
 * `gemini-flash-latest`（＝3.5-flash）は **20 req/日**で無料運用に耐えない、と判明。
 * P8c の eval（ゴールデン20問）で **`gemini-flash-lite-latest` が 20/20 合格・高速（~3s）・残枠あり**
 * だったため、**無料デプロイの既定に採用**する。品質重視/本番は有料枠 or Vertex の
 * `gemini-flash-latest`（または `gemini-3-flash-preview`）へ `GEMINI_MODEL` で差し替える。
 */
export const DEFAULT_CHAT_MODEL = 'gemini-flash-lite-latest'

/** ツールループの最大ステップ数（検索→詳細→…の多段呼び出し上限・plan_fable P8a）。 */
export const MAX_TOOL_STEPS = 6

/**
 * 1 リクエストの上限時間（ミリ秒・アプリ側 AbortSignal）。既定の flash-lite は多段でも ~3s だが、
 * 上位モデル（`gemini-flash-latest` 等）は 3 段クエリで 30–35s を要しうる。両対応で 45s とし、
 * graceful abort させる（Vercel 関数上限 60s より短く）。plan_fable P8a の 30s から実測で調整。
 */
export const CHAT_TIMEOUT_MS = 45_000

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
 * チャット用の言語モデルを構築する（Gemini・鍵はサーバ env のみ）。
 * `@ai-sdk/google` の既定 env は `GOOGLE_GENERATIVE_AI_API_KEY` のため、本プロジェクトの
 * `GEMINI_API_KEY` を明示注入する（.env.example 参照）。
 */
export function chatModel(): LanguageModel {
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('GEMINI_API_KEY が未設定です（.env に設定してください）')
  }
  const provider = createGoogleGenerativeAI({ apiKey })
  return provider(chatModelId())
}
