/**
 * チャットメッセージの parts から本文・地図応答を取り出す純関数（260802）。
 *
 * 吹き出しの描画（`ChatMessage`）とキャンバスの自動表示（`canvasTarget`）が
 * **同じ読み取り方**をするよう 1 か所にまとめる（.claude/CLAUDE.md §3 DRY）。
 */

import { type MapResponse } from '@/shared/protocol'
import { type ChatUIMessage } from './types'

type Part = ChatUIMessage['parts'][number]

/** text パートを連結する。 */
export function textOf(parts: readonly Part[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}

/**
 * 最後の data-map（MapResponse）を取り出す。
 * ストリーミング中は段階的に上書きされるため、**最後のもの**が最新の状態。
 */
export function mapResponseOf(parts: readonly Part[]): MapResponse | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part !== undefined && part.type === 'data-map') return part.data
  }
  return null
}

/**
 * 吹き出しに出す本文。**モデルの本文が無いときは、サーバが用意した一文に倒す**。
 *
 * サーバは本文が空で終わったターン（打ち切り・本文なしの正常終了）に、状況を言う一文を
 * data-map の `messages` に載せている（`assemble.ts` の `textOrFallback`・fail-soft F2）。
 * ところが画面は text パートしか描いておらず、**その一文が一度も表示されていなかった**
 * ——打ち切りでは本文もエラーも出ず、利用者には無言に見えた（2026-09-25 に判明）。
 */
export function displayTextOf(parts: readonly Part[]): string {
  const streamed = textOf(parts)
  if (streamed.length > 0) return streamed
  return mapResponseOf(parts)?.messages.at(-1)?.text ?? ''
}
