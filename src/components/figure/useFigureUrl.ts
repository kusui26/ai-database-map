'use client'

/**
 * 開いている図の読み書き（`url.ts`）。開く・閉じるは履歴に積み（戻るで取り消せる）、
 * 図の中の条件は積まずに書き換える（`docs/261001_fix_user_feedback_ui.md` §5.3）。
 */

import { useCallback, useMemo } from 'react'
import { useQueryStates, type HistoryOptions } from 'nuqs'
import { FIGURE_PARSERS, figureFromUrl, figureToUrl, type Figure } from './url'

export type FigureUrl = {
  /** 開いている図（開いていなければ null）。 */
  readonly figure: Figure | null
  /**
   * 図を開く。既定は push（戻るで閉じられる）。チャットの回答は「1 回の回答で 1 履歴」に
   * 合わせて replace を渡すことがある（`chat/answerHistory.ts`）。
   */
  readonly openFigure: (figure: Figure, history?: HistoryOptions) => void
  /** 図を閉じる（push＝戻るで開き直せる）。 */
  readonly closeFigure: () => void
  /** 図の中で変えた条件を書き戻す（replace＝履歴を増やさない）。 */
  readonly writeConditions: (figure: Figure) => void
}

export function useFigureUrl(): FigureUrl {
  const [values, setValues] = useQueryStates(FIGURE_PARSERS)
  const figure = useMemo(() => figureFromUrl(values), [values])

  const openFigure = useCallback(
    (next: Figure, history: HistoryOptions = 'push') => {
      void setValues(figureToUrl(next), { history })
    },
    [setValues],
  )
  const closeFigure = useCallback(() => {
    void setValues(null, { history: 'push' })
  }, [setValues])
  const writeConditions = useCallback(
    (next: Figure) => {
      void setValues(figureToUrl(next), { history: 'replace' })
    },
    [setValues],
  )

  return { figure, openFigure, closeFigure, writeConditions }
}
