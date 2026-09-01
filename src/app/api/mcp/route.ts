/**
 * リモート MCP サーバ（`docs/260828_research_claude_auth.md` §4.2 PR-2）。
 *
 * ユーザー自身の Claude（Claude Code / Claude.ai / Cowork）や他の MCP ホストが、
 * **本人のサブスクリプションで**当アプリの共通API を叩くための入口。
 * ツールの定義は `ai/tool-specs.ts`（Gemini と同一）、MCP への写しは `ai/mcp-tools.ts`。
 *
 * - 認証なし・読み取り専用（§4.3 Phase 1。オープンデータで、既存の共通API と同じ公開レベル）
 * - mcp-handler 2 系：MCP 2026-07-28 をネイティブに、2025 世代 Streamable HTTP は互換層で受ける。
 *   ステートレス（セッション・Redis なし）
 * - 濫用対策（§4.4）：ここで IP 全体の粗い制限、ツール別の制限は `mcp-tools.ts`
 *   （上流：気象庁・国土地理院を叩くものは厳しい）。本番強化は Vercel WAF（運用設定）を重ねる
 */

import { createMcpHandler } from 'mcp-handler'
import { checkRateLimit } from '@/ai/rate-limit'
import { mcpIpStore, registerMcpTools } from '@/ai/mcp-tools'
import { clientIp } from '@/lib/http'

/** ハザード系ツールは上流とメッシュ読みで時間がかかる（既定 300s の枠内で余裕を持たせる）。 */
export const maxDuration = 60

/** IP 全体の粗い上限（1 分・固定窓）。ツール別の細かい制限は mcp-tools 側。 */
const IP_LIMIT_PER_MINUTE = 60
const IP_WINDOW_MS = 60_000

/**
 * ハンドラはリクエストの origin に依存しない純関数群なので、プロセスで 1 個だけ作る。
 * `origin` はツール実行時に要る（浸水ナビ等の自己 API 呼び出し）ため、ALS ならぬ
 * リクエスト毎の値だが、Vercel では常に自分のデプロイ URL——`run` へは ALS でなく
 * リクエスト時に組み立てた origin を渡したいので、ハンドラ生成をリクエスト初回に遅延し、
 * origin をモジュール変数に固定する（同一デプロイでは不変）。
 */
let handler: ((request: Request) => Promise<Response>) | null = null

function handlerFor(origin: string): (request: Request) => Promise<Response> {
  if (handler === null) {
    handler = createMcpHandler(
      (server) => {
        registerMcpTools(server, origin)
      },
      { serverInfo: { name: 'ai-database-map', version: '1.0.0' } },
    )
  }
  return handler
}

async function serve(request: Request): Promise<Response> {
  const ip = clientIp(request)
  const limited = checkRateLimit(`mcp-ip:${ip}`, {
    limit: IP_LIMIT_PER_MINUTE,
    windowMs: IP_WINDOW_MS,
    now: Date.now(),
  })
  if (!limited.ok) {
    const retryAfterSec = Math.ceil(limited.retryAfterMs / 1000)
    return new Response(
      JSON.stringify({ error: 'rate_limited', retryAfterSeconds: retryAfterSec }),
      {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': String(retryAfterSec) },
      },
    )
  }
  const origin = new URL(request.url).origin
  return mcpIpStore.run(ip, () => handlerFor(origin)(request))
}

export { serve as GET, serve as POST }
