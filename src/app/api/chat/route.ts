/**
 * POST /api/chat（Step2・AIネイティブ化の中核）。
 *
 * AI SDK v6 のツールループ（streamText・stepCountIs 上限）で Gemini にツール（＝共通API/domain）を
 * 叩かせ、テキストをストリーミングする。ループ完了後、assemble.ts が **MapResponse(Zod検証済)** を
 * data-map パートで送出する（パネル・地図操作は domain が決定的に生成＝幻覚しない）。
 *
 * ガード：IP レート制限・入力 500 文字上限・履歴合計上限・50s abort・鍵未設定は 503・エラー封筒。
 * ツールが成果を出すたびに data-map を先出しし、本文が空でも必ず一言返す（fail-soft）。
 * `domain`・既存 API・protocol は無改変（純加算）。
 */

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai'
import { z } from 'zod'
import { mapResponseSchema } from '@/shared/protocol'
import { RADII_M } from '@/shared/constants'
import { apiError, clientIp } from '@/lib/http'
import { stationByGrp } from '@/db/queries'
import {
  CHAT_TIMEOUT_MS,
  chatModel,
  chatModelId,
  isChatConfigured,
  MAX_INPUT_CHARS,
  MAX_TOOL_STEPS,
} from '@/ai/client'
import { chatFailureLogLine, classifyChatFailure, failuresToRecord } from '@/ai/chat-errors'
import { CHAT_FAILURE_JA } from '@/shared/chat-errors'
import { createCollector } from '@/ai/types'
import { type ChatUIMessage, createTools } from '@/ai/tools'
import { buildSystemPrompt, mapContextPrompt } from '@/ai/system-prompt'
import { assemble, textOrFallback, type ChatOutcome } from '@/ai/assemble'
import { rateLimit } from '@/ai/rate-limit'

export const runtime = 'nodejs'
/** Vercel 関数の実行上限（秒）。アプリ側 50s abort（`CHAT_TIMEOUT_MS`）に対する外枠（Hobby 上限 60s）。 */
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
  // 地図で選択中の駅・半径（P8e）。クライアントが sendMessage の body で同送する。
  selectedGrp: z.string().optional(),
  radiusM: z.number().optional(),
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

/** 会話履歴の合計文字数の上限（500 字ガードを履歴詰め込みで回避されないため・plan_fable §7）。 */
const MAX_CONVERSATION_CHARS = 4000

/**
 * data-map パートの固定 id。ツール成功のたびに同じ id で上書きし、
 * 最後の完全版が権威になる（部分成果の先出し・fail-soft）。
 */
const MAP_PART_ID = 'map'

/**
 * ターンの終わり方を判定する（本文が空のときの言い換えに使う）。
 * 中断は AbortSignal を直接見る（abort 時に `result.text` は reject せず空で解決しうるため）。
 */
function outcomeOf(aborted: boolean, failureCount: number): ChatOutcome {
  if (aborted) return 'aborted'
  return failureCount > 0 ? 'failed' : 'ok'
}

/**
 * ストリームの失敗を、利用者に見せる 1 文にする。**種類はエラーの中身（HTTP 状態）で決める**——
 * 以前は文言の正規表現で判定しており、提供元の 500 のような一時的な不調を「生成に失敗」に落としていた
 * （2026-09-25 の障害）。文そのものは `shared/chat-errors.ts` が持ち、画面も同じ語彙で読む。
 */
function failureSentence(error: unknown): string {
  return CHAT_FAILURE_JA[classifyChatFailure(error).kind]
}

/**
 * 失敗を 1 件ずつ記録する。**元のエラーを捨てない**——捨てると、次の障害で原因が分からない
 * （2026-09-25）。重複・打ち切りの残骸・派生のエラーを除く規則は `failuresToRecord`。
 */
function logFailures(
  failures: readonly unknown[],
  aborted: boolean,
  startedAt: number,
  utterances: string[],
): void {
  const context = { modelId: chatModelId(), elapsedMs: Date.now() - startedAt, utterances }
  for (const failure of failuresToRecord(failures, aborted)) {
    console.error(chatFailureLogLine(classifyChatFailure(failure), context))
  }
}

/** text だけの UIMessage を構築（id は convertToModelMessages で不要）。 */
function textMessage(role: 'user' | 'assistant', text: string): Omit<UIMessage, 'id'> {
  const parts: UIMessage['parts'] = [{ type: 'text', text }]
  return { role, parts }
}

/**
 * 地図で選択中の駅（＋半径）を LLM 文脈へ解決する（P8e）。
 * 未選択・不正半径・未存在 grp・DB 失敗のいずれでも空文字を返し、文脈なしで安全に続行する。
 */
async function resolveMapContext(selectedGrp?: string, radiusM?: number): Promise<string> {
  if (selectedGrp === undefined || selectedGrp.length === 0) return ''
  const radius = RADII_M.find((valid) => valid === radiusM) ?? 1000
  try {
    const station = await stationByGrp(selectedGrp)
    return station === null ? '' : mapContextPrompt(station, radius)
  } catch {
    return ''
  }
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now()
  // 1) レート制限（IP・固定窓）。鍵に `chat:` を付けるのは、`checkRateLimit` の store が
  //    **全ルート共通の 1 つの Map** だから——生の IP のままだと、次に誰かが同じ鍵で数えた瞬間に
  //    バケツを共有してしまう（他の 7 ルートは既に `hazard-point:` のように名前を付けている）。
  const limit = rateLimit(`chat:${clientIp(request)}`, startedAt)
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

  // 地図で選択中の駅を LLM の文脈に（P8e）。未選択・解決失敗なら文脈なしで続行（安全側）。
  const mapContext = await resolveMapContext(parsed.data.selectedGrp, parsed.data.radiusM)
  // 失敗を記録するとき、提供元の説明に紛れた発話を伏せるために使う（ログには決して出さない）。
  const utterances = conversation.map((message) => message.text)

  // 4) ツールループ＋ストリーミング
  const uiMessages = conversation.map((message) => textMessage(message.role, message.text))

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      // ツールが成果を出すたびに、その時点のパネル/地図操作を先に送る（fail-soft）。
      // 同じ id で上書きするため、最後に送る完全版が常に権威になる。
      const collector = createCollector((effects) => {
        writer.write({
          type: 'data-map',
          id: MAP_PART_ID,
          data: mapResponseSchema.parse(assemble(effects, '')),
        })
      })
      const modelMessages = await convertToModelMessages(uiMessages)
      const abortSignal = AbortSignal.timeout(CHAT_TIMEOUT_MS)
      const failures: unknown[] = []
      // ツールループ（stopWhen で最大 MAX_TOOL_STEPS 回）。以前は ToolLoopAgent 経由だったが、
      // あれは streamText の薄い包みで `onError` を型の上で渡せない。SDK の既定の `onError` は
      // 失敗のたびに生のエラー（提供元の説明・応答本文）を console.error に出すので、発話が紛れうる。
      // 記録は logFailures の 1 行（発話を伏せる）に一本化するため、ここで受け取って握る。
      const result = streamText({
        model: chatModel(),
        system: buildSystemPrompt() + mapContext,
        tools: createTools(collector, new URL(request.url).origin),
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        temperature: 0.2,
        // 対話は fail-fast 寄りに。既定 2 だと無料枠 429 の retry-after を待って長く固まる。
        maxRetries: 1,
        messages: modelMessages,
        abortSignal,
        onError: ({ error }) => {
          failures.push(error)
        },
      })
      // テキスト/ツールパートを即時ストリーム。内側にも failureSentence を渡す
      // （渡さないと SDK 既定の英語 "An error occurred." がクライアントに届く）。
      writer.merge(
        result.toUIMessageStream<ChatUIMessage>({
          onError: (error) => {
            failures.push(error)
            return failureSentence(error)
          },
        }),
      )
      // ループ完了後、domain が決定的に組み立てた MapResponse を data-map で送出。
      // 生成が途中でエラー/中断しても、それまでの副産物からパネル/地図を組み立てて返す
      // （reject を握って二重エラー＋data-map 欠落を防ぐ）。
      const text = await Promise.resolve(result.text).catch((error: unknown) => {
        failures.push(error)
        return ''
      })
      const effects = collector.drain()
      // 本文が空でも必ず一言返す（中断・エラー・ステップ上限のいずれでも無言にしない）。
      const panelCount = assemble(effects, '').panels.length
      const outcome = outcomeOf(abortSignal.aborted, failures.length)
      const mapResponse = mapResponseSchema.parse(
        assemble(effects, textOrFallback(text, panelCount, outcome)),
      )
      writer.write({ type: 'data-map', id: MAP_PART_ID, data: mapResponse })
      // 失敗の中身を 1 件ずつ（種類・HTTP 状態・回数）。続けて 1 行サマリ。どちらも発話は出さない。
      logFailures(failures, abortSignal.aborted, startedAt, utterances)
      console.info(
        `[api/chat] ${outcome} ${Date.now() - startedAt}ms effects=${effects.length} panels=${panelCount} text=${text.length > 0}`,
      )
    },
    onError: (error) => {
      logFailures([error], false, startedAt, utterances)
      return failureSentence(error)
    },
  })

  return createUIMessageStreamResponse({ stream })
}
