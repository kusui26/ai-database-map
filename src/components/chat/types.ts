/**
 * チャット UI（クライアント）用の UIMessage 型。
 * サーバの `@/ai/tools`（db/AI SDK を読む）を client バンドルに持ち込まないよう、
 * ここでは data パート（data-map＝MapResponse）だけを型付けし、ツールパートは既定（汎用）で扱う
 * （インライン描画はツール入力を汎用的に読むため、厳密なツール型は不要）。
 */

import { type UIMessage } from 'ai'
import { type MapResponse } from '@/shared/protocol'

export type ChatDataParts = { map: MapResponse }

/** useChat<ChatUIMessage>。message.parts は text / data-map / tool-* を含む。 */
export type ChatUIMessage = UIMessage<unknown, ChatDataParts>
