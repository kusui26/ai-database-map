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
