'use client'

/**
 * 選択駅（?grp）と半径（?r）を URL に双方向同期する（nuqs）。
 * 共有リンク・リロードで状態が復元される（地図アプリの必須機能）。
 *
 * ## 履歴（2026-10-02・`docs/261001_fix_user_feedback_ui.md` §5.3）
 *
 * - **駅を選ぶ・閉じるは push**：場所を移る＝移動。ブラウザの「戻る」で前の駅へ戻れる
 *   （地図も飛んで戻る）。以前はすべて replace で、戻るとアプリの外へ出ていた
 * - **半径は replace**：同じ場所での調整。積むと、戻るが調整を 1 つずつ遡るだけになる
 * - **選んでいる駅をもう一度選んでも、何も書かない**：同じ URL の履歴を積まない（`selection.ts`）
 *
 * AI の回答は「1 回の回答で 1 履歴」に合わせて、呼ぶ側が `{ history }` を渡す（`chat/answerHistory.ts`）。
 *
 * ## 携帯の駅詳細シートを閉じたままにする（?sheet=closed・2026-10-02・§4.4(b)）
 *
 * 携帯では駅詳細がボトムシートで、開くとチャットのシートを覆う。チャットを開いている間に AI が駅を
 * 選んだときは、駅は選ぶ（地図の印・「この駅」の文脈）が、シートは開かない。回答の図は会話の中に出す。
 * 印を URL に置くのは、⤢ でシートを開くのを 1 つの履歴にして、**戻る 1 回でシートだけを閉じる**ため。
 * 利用者が駅を選ぶ（⤢・地図・検索・会話の駅名）と印は消え、シートが開く。広い画面は印を見ない。
 */

import { useCallback, useRef } from 'react'
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  type Options,
} from 'nuqs'
import { RADII_M } from '@/shared/constants'
import { selectionWrite, type Selection } from './selection'

const DEFAULT_RADIUS_M = 1000
const SHEET_STATES = ['closed'] as const

const grpParser = parseAsString.withOptions({ history: 'push' })
const radiusParser = parseAsInteger.withDefault(DEFAULT_RADIUS_M)
const sheetParser = parseAsStringLiteral(SHEET_STATES)

export function useMapUrlState() {
  const [grp, setRawGrp] = useQueryState('grp', grpParser)
  const [sheet, setSheet] = useQueryState('sheet', sheetParser)
  const [r, setRadiusM] = useQueryState('r', radiusParser)
  // 不正な r（6段以外）は既定に丸める
  const radiusM = RADII_M.some((valid) => valid === r) ? r : DEFAULT_RADIUS_M
  const sheetClosed = sheet === 'closed'
  // 最後に書いた選択。同じ tick に 2 回選ぶ（2 駅を比べる回答など）とき、描画前の古い値で比べないため。
  const latest = useRef<Selection>({ grp, sheetClosed })
  latest.current = { grp, sheetClosed }

  /** 駅を選ぶ・閉じる。変わるものだけを書く（`selection.ts`）。シートの印も消す。 */
  const setGrp = useCallback(
    (next: string | null, options?: Options): void => {
      const write = selectionWrite(latest.current, next)
      latest.current = { grp: next, sheetClosed: false }
      // 印だけが変わる（⤢ でシートを開く）のも 1 つの移動なので、既定は push。
      if (write.clearSheet) void setSheet(null, { history: 'push', ...options })
      if (write.grp) void setRawGrp(next, options)
    },
    [setRawGrp, setSheet],
  )
  /** AI が選んだ駅の詳細シートを、閉じたままにする（`setGrp` のあと・同じ tick で呼ぶ）。 */
  const keepSheetClosed = useCallback(
    (options?: Options): void => {
      latest.current = { ...latest.current, sheetClosed: true }
      void setSheet('closed', options)
    },
    [setSheet],
  )

  return { grp, setGrp, radiusM, setRadiusM, sheetClosed, keepSheetClosed }
}
