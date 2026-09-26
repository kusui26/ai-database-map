/**
 * チャット UI（クライアント）用の UIMessage 型。
 * サーバの `@/ai/tools`（db/AI SDK を読む）を client バンドルに持ち込まないよう、
 * ここでは data パート（data-map＝MapResponse）だけを型付けし、ツールパートは既定（汎用）で扱う
 * （インライン描画はツール入力を汎用的に読むため、厳密なツール型は不要）。
 */

import { type UIMessage } from 'ai'
import { type PanelPromotions } from '@/shared/promotion'
import { type MapResponse } from '@/shared/protocol'

/** data-map＝MapResponse、data-promotions＝その ⤢ の条件（パネルと同じ並び）。 */
export type ChatDataParts = { map: MapResponse; promotions: PanelPromotions }

/** useChat<ChatUIMessage>。message.parts は text / data-map / tool-* を含む。 */
export type ChatUIMessage = UIMessage<unknown, ChatDataParts>
