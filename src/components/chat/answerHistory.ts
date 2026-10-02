/**
 * **1 回の回答で積む履歴は 1 つ**（2026-10-02・`docs/261001_fix_user_feedback_ui.md` §5.4）。
 *
 * 回答は URL を何度も書く——焦点のタブ、地図の操作（駅の選択・半径・ハザード）、キャンバスの図。
 * サーバはツールが成功するたびに図と操作を送り直すので、書くたびに積むと 1 回の回答で履歴が
 * 2〜3 個積まれ、「戻る」を押しても何も変わらないことが起きる。最初に書くときだけ push、以後は replace。
 *
 * 回答の途中で利用者が「戻る／進む」を押したら、その回答はもう URL を書かない。書き続けると、
 * 送り直しが**戻った先の履歴**を上書きし、戻ったはずの駅や図が出てきてしまう。
 */

import type { HistoryOptions } from 'nuqs'

export type AnswerHistory = {
  /** URL を書く直前に呼ぶ。この回答で最初なら push、2 回目からは replace。止めている間は null（書かない）。 */
  readonly take: () => HistoryOptions | null
  /** この回答をまだ地図と URL に反映してよいか（戻る／進むで止められていないか）。 */
  readonly isActive: () => boolean
  /** 質問を送るときに呼ぶ（次の回答の最初を push に戻し、止めていたら再開する）。 */
  readonly reset: () => void
  /** 利用者が「戻る／進む」を押したときに呼ぶ（この回答はもう URL を書かない）。 */
  readonly suspend: () => void
}

export function createAnswerHistory(): AnswerHistory {
  let pushed = false
  let suspended = false
  return {
    take: () => {
      if (suspended) return null
      if (pushed) return 'replace'
      pushed = true
      return 'push'
    },
    isActive: () => !suspended,
    reset: () => {
      pushed = false
      suspended = false
    },
    suspend: () => {
      suspended = true
    },
  }
}
