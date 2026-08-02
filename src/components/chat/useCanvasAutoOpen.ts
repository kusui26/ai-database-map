'use client'

/**
 * 回答に散布・ランキングが含まれたら、キャンバスへ自動で出す（260802）。
 *
 * 「初期表示では地図を隠さない」ため、**メッセージが無い間は何もしない**（対象が null）。
 * 適用済みの鍵を覚え、同じ回答では二度と開かない＝ストリーミング中の再取得も、
 * ユーザーが閉じたあとの復活も起きない（docs/260802_ai_chat_canvs.md §5）。
 *
 * narrow・モバイルでは呼び出し側が `enabled=false` にする（勝手にモーダルが出ないように）。
 */

import { useEffect, useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { type ChatUIMessage } from './types'
import { canvasTargetOf } from './canvasTarget'

export function useCanvasAutoOpen(messages: readonly ChatUIMessage[], enabled: boolean): void {
  const promote = useChatStore((state) => state.promote)
  const canvasKey = useChatStore((state) => state.canvasKey)
  const setCanvasKey = useChatStore((state) => state.setCanvasKey)

  const target = useMemo(() => (enabled ? canvasTargetOf(messages) : null), [messages, enabled])

  useEffect(() => {
    if (target === null || target.key === canvasKey) return
    setCanvasKey(target.key)
    promote(target.promotion)
  }, [target, canvasKey, setCanvasKey, promote])
}
