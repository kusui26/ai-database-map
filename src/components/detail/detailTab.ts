/**
 * 駅詳細のタブを **URL（`?tab`）→ この端末で最後に見たタブ → 乗降客数** の順で決める（純関数と保存）。
 *
 * ## なぜ覚えるか（2026-10-02・`docs/261001_fix_user_feedback_ui.md` §2）
 *
 * 以前は駅を替えるたびに乗降客数タブへ戻していた。「通常は同じ項目をみたいので、ブラウザに
 * 覚えておいてほしい」というフィードバックどおり、タブは URL に載せ（駅を替えても残る・リロード・
 * 共有リンク）、URL に無いときは**この端末で最後に見たタブ**を使う。
 *
 * ## 記憶は「便利」であって「正」ではない
 *
 * localStorage はプライベートモードや設定によって、読めない・書けない・触っただけで投げる。
 * どの場合も黙って「記憶なし」に倒す——記憶が無くても、表示そのもの（URL）は壊れない。
 */

import { DEFAULT_DETAIL_TAB, DETAIL_TABS, type DetailTab } from '@/shared/constants'

/** URL のパラメータ名（`?grp` `?r` と同じ流儀の短い名前）。 */
export const DETAIL_TAB_PARAM = 'tab'

/** この端末に覚えるときのキー（アプリ名で名前空間を切る）。 */
export const DETAIL_TAB_STORAGE_KEY = 'ai-database-map:detail-tab'

/** 記憶の置き場（`localStorage` のうち使う部分だけ。テストでは差し替える）。 */
export type TabStorage = Pick<Storage, 'getItem' | 'setItem'>

/** 駅詳細のタブとして使える値か。URL・保存値など、外から来た値はすべてこれを通す。 */
export function isDetailTab(value: unknown): value is DetailTab {
  return DETAIL_TABS.some((tab) => tab === value)
}

/** 表示するタブ。URL（共有リンク・戻る/進む）→ この端末で最後に見たタブ → 既定（乗降客数）。 */
export function resolveDetailTab(
  urlTab: DetailTab | null,
  rememberedTab: DetailTab | null,
): DetailTab {
  return urlTab ?? rememberedTab ?? DEFAULT_DETAIL_TAB
}

/** この端末で最後に見たタブ。無い・知らない値・読めないときは null。 */
export function readRememberedDetailTab(storage: TabStorage | null): DetailTab | null {
  try {
    const stored = storage?.getItem(DETAIL_TAB_STORAGE_KEY) ?? null
    return isDetailTab(stored) ? stored : null
  } catch {
    return null // 読めない端末（プライベートモードなど）は「記憶なし」と同じ
  }
}

/** 選んだタブを覚える。書けなくても何もしない（表示は URL で続く）。 */
export function rememberDetailTab(storage: TabStorage | null, tab: DetailTab): void {
  try {
    storage?.setItem(DETAIL_TAB_STORAGE_KEY, tab)
  } catch {
    // 容量超過・保存の拒否。記憶は便利のためだけのもので、失敗を利用者に見せる理由が無い。
  }
}

/** ブラウザの localStorage（サーバと、使えない端末では null）。参照しただけで投げる端末がある。 */
export function browserTabStorage(): TabStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
