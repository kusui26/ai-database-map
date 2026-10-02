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
 *
 * AI の回答は「1 回の回答で 1 履歴」に合わせて、呼ぶ側が `{ history }` を渡す（`chat/answerHistory.ts`）。
 */

import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
import { RADII_M } from '@/shared/constants'

const DEFAULT_RADIUS_M = 1000

const grpParser = parseAsString.withOptions({ history: 'push' })
const radiusParser = parseAsInteger.withDefault(DEFAULT_RADIUS_M)

export function useMapUrlState() {
  const [grp, setGrp] = useQueryState('grp', grpParser)
  const [r, setRadiusM] = useQueryState('r', radiusParser)
  // 不正な r（6段以外）は既定に丸める
  const radiusM = RADII_M.some((valid) => valid === r) ? r : DEFAULT_RADIUS_M
  return { grp, setGrp, radiusM, setRadiusM }
}
