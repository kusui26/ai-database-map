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
 * 既定モデル（Gemini Flash 系・architecture.md §10.2）。env `GEMINI_MODEL` で上書き可能。
 * 2026-07 時点、plan_fable が主モデルとした `gemini-2.5-flash` は**新規 API ユーザーに提供終了**
 * （generateContent が 404）。安定運用のため、Google が現行 Flash に追随させるエイリアス
 * `gemini-flash-latest`（function calling 対応・日本語良好・実測で多段ツール利用が成功）を既定にする。
 * 採用モデル（固定バージョン）の最終確定は P8c の eval（コスト×tool-use 精度）で行う。
 */
export const DEFAULT_CHAT_MODEL = 'gemini-flash-latest'

/** ツールループの最大ステップ数（検索→詳細→…の多段呼び出し上限・plan_fable P8a）。 */
export const MAX_TOOL_STEPS = 6

/**
 * 1 リクエストの上限時間（ミリ秒・アプリ側 AbortSignal）。
 * plan_fable P8a は 30s を掲げるが、主モデル差し替え後の実測で「検索→詳細→本文」の 3 段クエリは
 * 現行 Gemini 負荷下で 30–35s を要する。graceful abort させるため 45s とし、関数上限(60s)より短くする。
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
