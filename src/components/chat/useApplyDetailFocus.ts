'use client'

/**
 * 回答に駅詳細の焦点があれば、ドロワーをそのタブで開く（`detailFocus.ts`）。
 *
 * data-promotions は data-map の**前**に届く（`/api/chat` の `writeMap`）。ここでタブを書いておけば、
 * 続く `selectStation` でドロワーが開いた瞬間から聞いたタブになる（乗降客数が一瞬出ることもない）。
 *
 * サーバはツールが成功するたびに条件を送り直すので、**同じ焦点は 1 回の回答で 1 度だけ**当てる——
 * 回答の途中で利用者が別のタブに替えたのを、送り直しで戻さないため。質問を送るたびに `reset` する。
 *
 * 当てるときは `useSelectDetailTab` を通す（タブ帯で選んだのと同じ＝URL に書き、この端末にも覚える）。
 * 履歴はその回答の約束に従う（最初に URL を書くなら push・`answerHistory.ts`）。
 */

import { useCallback, useMemo, useRef } from 'react'
import { useSelectDetailTab } from '@/components/detail/useDetailTab'
import { type AnswerHistory } from './answerHistory'
import { focusToApply } from './detailFocus'

export type DetailFocusApplier = {
  /** data-promotions の中身（未検証）を受け、焦点があればそのタブを選ぶ。 */
  readonly apply: (data: unknown) => void
  /** 質問を送るときに呼ぶ（次の回答の焦点を当てられるようにする）。 */
  readonly reset: () => void
}

export function useApplyDetailFocus(answerHistory: AnswerHistory): DetailFocusApplier {
  const selectDetailTab = useSelectDetailTab()
  const appliedKey = useRef<string | null>(null)

  const apply = useCallback(
    (data: unknown) => {
      const next = focusToApply(data, appliedKey.current)
      if (next === null) return
      appliedKey.current = next.key
      const history = answerHistory.take()
      if (history !== null) selectDetailTab(next.focus.tab, history)
    },
    [selectDetailTab, answerHistory],
  )
  const reset = useCallback(() => {
    appliedKey.current = null
  }, [])

  return useMemo(() => ({ apply, reset }), [apply, reset])
}
