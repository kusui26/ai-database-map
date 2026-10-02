'use client'

/**
 * 回答に散布・ランキングが含まれたら、キャンバスへ自動で出す（260802）。
 *
 * 「初期表示では地図を隠さない」ため、**メッセージが無い間は何もしない**（対象が null）。
 * 適用済みの鍵を覚え、同じ回答では二度と開かない＝ストリーミング中の再取得も、
 * ユーザーが閉じたあと（戻るで閉じたあとも）の復活も起きない（docs/260802_ai_chat_canvs.md §5）。
 *
 * 図は URL（`?fig`）に書く（2026-10-02）。履歴はその回答の約束に従う——回答が駅も選んでいれば
 * 同じ履歴に入り、「戻る」1 回で駅も図も回答の前に戻る（`answerHistory.ts`）。回答の途中で
 * 「戻る／進む」を押されたら、その回答の図は開かない。
 *
 * narrow・モバイルでは呼び出し側が `enabled=false` にする（勝手にモーダルが出ないように）。
 */

import { useEffect, useMemo } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useFigureUrl } from '@/components/figure/useFigureUrl'
import { type ChatUIMessage } from './types'
import { type AnswerHistory } from './answerHistory'
import { canvasTargetOf } from './canvasTarget'

export function useCanvasAutoOpen(
  messages: readonly ChatUIMessage[],
  enabled: boolean,
  answerHistory: AnswerHistory,
): void {
  const { openFigure } = useFigureUrl()
  const canvasKey = useChatStore((state) => state.canvasKey)
  const setCanvasKey = useChatStore((state) => state.setCanvasKey)

  const target = useMemo(() => (enabled ? canvasTargetOf(messages) : null), [messages, enabled])

  useEffect(() => {
    if (target === null || target.key === canvasKey) return
    setCanvasKey(target.key)
    const history = answerHistory.take()
    if (history !== null) openFigure(target.promotion, history)
  }, [target, canvasKey, setCanvasKey, openFigure, answerHistory])
}
