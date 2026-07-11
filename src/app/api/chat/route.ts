/**
 * POST /api/chat（Step2・AIネイティブ化の中核）。
 *
 * AI SDK v6 のツールループ（ToolLoopAgent・stepCountIs 上限）で Gemini にツール（＝共通API/domain）を
 * 叩かせ、テキストをストリーミングする。ループ完了後、assemble.ts が **MapResponse(Zod検証済)** を
 * data-map パートで送出する（パネル・地図操作は domain が決定的に生成＝幻覚しない）。
 *
 * ガード：IP レート制限・入力 500 文字上限・30s タイムアウト・鍵未設定は 503・エラー封筒。
 * `domain`・既存 API・protocol は無改変（純加算）。
 */

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  ToolLoopAgent,
  type UIMessage,
} from 'ai'
import { z } from 'zod'
import { mapResponseSchema } from '@/shared/protocol'
import { apiError } from '@/lib/http'
import {
  CHAT_TIMEOUT_MS,
  chatModel,
  isChatConfigured,
  MAX_INPUT_CHARS,
  MAX_TOOL_STEPS,
} from '@/ai/client'
import { createCollector } from '@/ai/types'
import { type ChatUIMessage, createTools } from '@/ai/tools'
import { buildSystemPrompt } from '@/ai/system-prompt'
import { assemble } from '@/ai/assemble'
import { rateLimit } from '@/ai/rate-limit'

export const runtime = 'nodejs'
/** Vercel 関数の実行上限（秒）。アプリ側 45s abort に対する外枠（Hobby 上限 60s）。 */
export const maxDuration = 60

// --- 入力（useChat 互換：UIMessage[]） ----------------------------------
const inboundPartSchema = z.object({ type: z.string(), text: z.string().optional() })
const inboundMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(inboundPartSchema).optional(),
  content: z.string().optional(),
})
const inboundSchema = z.object({
  messages: z.array(inboundMessageSchema).min(1).max(50),
})

type InboundMessage = z.infer<typeof inboundMessageSchema>

/** メッセージからテキストを取り出す（parts の text を優先・なければ content）。 */
function messageText(message: InboundMessage): string {
  if (message.parts !== undefined) {
    const texts = message.parts
      .filter((part) => part.type === 'text' && part.text !== undefined)
      .map((part) => part.text ?? '')
    if (texts.length > 0) return texts.join('').trim()
  }
  return (message.content ?? '').trim()
}

/** リクエスト元 IP（プロキシヘッダ優先）。 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded !== null && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/** text だけの UIMessage を構築（id は convertToModelMessages で不要）。 */
function textMessage(role: 'user' | 'assistant', text: string): Omit<UIMessage, 'id'> {
  const parts: UIMessage['parts'] = [{ type: 'text', text }]
  return { role, parts }
}

export async function POST(request: Request): Promise<Response> {
  // 1) レート制限（IP・固定窓）
  const limit = rateLimit(clientIp(request), Date.now())
  if (!limit.ok) {
    const retryAfter = Math.ceil(limit.retryAfterMs / 1000)
    return apiError(
      'RATE_LIMITED',
      `リクエストが多すぎます。${retryAfter}秒後に再試行してください。`,
      429,
    )
  }

  // 2) 鍵の確認（未設定は 503）
  if (!isChatConfigured()) {
    return apiError('NOT_CONFIGURED', 'チャットは未設定です（GEMINI_API_KEY）。', 503)
  }

  // 3) 入力の検証
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('BAD_REQUEST', 'JSON の解析に失敗しました。', 400)
  }
  const parsed = inboundSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('BAD_REQUEST', parsed.error.issues[0]?.message ?? '入力が不正です。', 400)
  }

  const conversation = parsed.data.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, text: messageText(message) }))
    .filter(
      (message): message is { role: 'user' | 'assistant'; text: string } => message.text.length > 0,
    )

  const lastUser = [...conversation].reverse().find((message) => message.role === 'user')
  if (lastUser === undefined) {
    return apiError('BAD_REQUEST', 'ユーザーの発話がありません。', 400)
  }
  if (lastUser.text.length > MAX_INPUT_CHARS) {
    return apiError('BAD_REQUEST', `入力は ${MAX_INPUT_CHARS} 文字以内にしてください。`, 400)
  }

  // 4) ツールループ＋ストリーミング
  const uiMessages = conversation.map((message) => textMessage(message.role, message.text))
  const collector = createCollector()
  const tools = createTools(collector)

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      const agent = new ToolLoopAgent({
        model: chatModel(),
        instructions: buildSystemPrompt(),
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        temperature: 0.2,
      })
      const modelMessages = await convertToModelMessages(uiMessages)
      const result = await agent.stream({
        messages: modelMessages,
        abortSignal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      })
      // テキスト/ツールパートを即時ストリーム（返答中に地図操作の材料が揃う）
      writer.merge(result.toUIMessageStream<ChatUIMessage>())
      // ループ完了後、domain が決定的に組み立てた MapResponse を data-map で送出
      const text = await result.text
      const mapResponse = mapResponseSchema.parse(assemble(collector.drain(), text))
      writer.write({ type: 'data-map', data: mapResponse })
    },
    onError: (error) => {
      console.error('[api/chat] stream error:', error)
      return 'エラーが発生しました。時間をおいて再試行してください。'
    },
  })

  return createUIMessageStreamResponse({ stream })
}
