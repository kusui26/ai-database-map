/**
 * POST /api/chat（Step2・AIネイティブ化の中核）。
 *
 * AI SDK v6 のツールループ（ToolLoopAgent・stepCountIs 上限）で Gemini にツール（＝共通API/domain）を
 * 叩かせ、テキストをストリーミングする。ループ完了後、assemble.ts が **MapResponse(Zod検証済)** を
 * data-map パートで送出する（パネル・地図操作は domain が決定的に生成＝幻覚しない）。
 *
 * ガード：IP レート制限・入力 500 文字上限・履歴合計上限・45s abort・鍵未設定は 503・エラー封筒。
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

/** リクエスト元 IP。プラットフォームが設定する x-real-ip を優先（XFF 左端は詐称可能）。 */
function clientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')
  if (realIp !== null && realIp.length > 0) return realIp
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() ?? 'unknown'
}

/** 会話履歴の合計文字数の上限（500 字ガードを履歴詰め込みで回避されないため・plan_fable §7）。 */
const MAX_CONVERSATION_CHARS = 4000

/** ストリームエラーをユーザー向けの短い日本語に変換（無料枠 429/混雑は専用文言に）。 */
function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/429|quota|rate|RESOURCE_EXHAUSTED|overloaded|503|UNAVAILABLE/i.test(message)) {
    return 'ただいま混雑しています（無料枠の上限の可能性があります）。少し時間をおいて再度お試しください。'
  }
  return '応答の生成に失敗しました。時間をおいて再度お試しください。'
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
  const totalChars = conversation.reduce((sum, message) => sum + message.text.length, 0)
  if (totalChars > MAX_CONVERSATION_CHARS) {
    return apiError('BAD_REQUEST', '会話が長くなりました。新しい会話を始めてください。', 400)
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
        // 対話は fail-fast 寄りに。既定 2 だと無料枠 429 の retry-after を待って長く固まる。
        maxRetries: 1,
      })
      const modelMessages = await convertToModelMessages(uiMessages)
      const result = await agent.stream({
        messages: modelMessages,
        abortSignal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      })
      // テキスト/ツールパートを即時ストリーム。内側にも friendlyError を渡す
      // （渡さないと SDK 既定の英語 "An error occurred." がクライアントに届く）。
      writer.merge(result.toUIMessageStream<ChatUIMessage>({ onError: friendlyError }))
      // ループ完了後、domain が決定的に組み立てた MapResponse を data-map で送出。
      // 生成が途中でエラー/中断しても、それまでの副産物からパネル/地図を組み立てて返す
      // （.catch で二重エラー＋data-map 欠落を防ぐ）。
      const text = await Promise.resolve(result.text).catch(() => '')
      const mapResponse = mapResponseSchema.parse(assemble(collector.drain(), text))
      writer.write({ type: 'data-map', data: mapResponse })
    },
    onError: (error) => {
      console.error('[api/chat] stream error:', error instanceof Error ? error.message : error)
      return friendlyError(error)
    },
  })

  return createUIMessageStreamResponse({ stream })
}
