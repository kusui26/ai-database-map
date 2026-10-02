/**
 * 駅を選ぶ（閉じる）ときに、URL へ何を書くか（純関数・2026-10-02）。
 *
 * nuqs は値が変わらなくても書き込み、push なら**同じ URL の履歴**を積む。選んでいる駅をもう一度選ぶ
 * （チップ・地図・検索）たびに空の履歴が積まれ、ブラウザの「戻る」を押しても何も変わらない回ができていた
 * （A3 で駅の選択を push にしてから。`docs/261001_fix_user_feedback_ui.md` §4.7）。変わるものだけを書く。
 */

/** いまの選択：駅と、携帯の駅詳細シートを閉じたままにする印（`?sheet=closed`）。 */
export type Selection = {
  readonly grp: string | null
  readonly sheetClosed: boolean
}

/** 書くもの。どちらも false なら何も書かない（履歴も積まない）。 */
export type SelectionWrite = {
  /** 駅（`?grp`）を書くか。 */
  readonly grp: boolean
  /** シートの印を消すか（同じ駅なら、シートを開くことになる）。 */
  readonly clearSheet: boolean
}

export function selectionWrite(current: Selection, next: string | null): SelectionWrite {
  return { grp: current.grp !== next, clearSheet: current.sheetClosed }
}
