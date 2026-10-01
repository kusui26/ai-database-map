'use client'

/**
 * 駅詳細のタブ（`?tab`）。表示は `resolveDetailTab` で決め、選び直しは URL とこの端末の記憶の両方に書く。
 *
 * - **駅を替えても残る**：`setGrp` は `?grp` しか触らないので、`?tab` はそのまま残る
 * - **チャットの焦点も同じ道を通る**：AI が人口を聞かれて駅詳細を開くときも `useSelectDetailTab`。
 *   以前は「1 回だけ消費する要求」を別に持ち、駅が変わったら乗降へ戻す効果と譲り合っていた
 * - **履歴には積まない**（replace）：タブは同じ画面の中での調整（`docs/261001_fix_user_feedback_ui.md` §5.3）
 * - **乗降客数も URL に明示して書く**：URL に無いときは「この端末の記憶」を使うので、既定値だけ
 *   URL から消すと「乗降を選んだ」と「まだ何も選んでいない」の区別がつかなくなる
 */

import { useCallback, useState } from 'react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { DETAIL_TABS, type DetailTab } from '@/shared/constants'
import {
  browserTabStorage,
  DETAIL_TAB_PARAM,
  readRememberedDetailTab,
  rememberDetailTab,
  resolveDetailTab,
} from './detailTab'

/** 9 タブ以外の値（手で書き換えた URL など）は null＝URL に無いのと同じ扱いになる。 */
const tabParser = parseAsStringLiteral(DETAIL_TABS).withOptions({ history: 'replace' })

/** タブを選ぶ（URL に書き、この端末にも覚える）。タブ帯・災害バッジ・チャットの焦点が使う。 */
export function useSelectDetailTab(): (tab: DetailTab) => void {
  const [, setUrlTab] = useQueryState(DETAIL_TAB_PARAM, tabParser)
  return useCallback(
    (tab: DetailTab) => {
      rememberDetailTab(browserTabStorage(), tab)
      void setUrlTab(tab)
    },
    [setUrlTab],
  )
}

/** 表示中のタブと、その選び直し。 */
export function useDetailTab(): readonly [DetailTab, (tab: DetailTab) => void] {
  const [urlTab] = useQueryState(DETAIL_TAB_PARAM, tabParser)
  // 記憶は最初の描画で 1 回だけ読む。以後に選んだタブは URL に載るので、読み直す必要が無い。
  const [rememberedTab] = useState(() => readRememberedDetailTab(browserTabStorage()))
  const selectTab = useSelectDetailTab()
  return [resolveDetailTab(urlTab, rememberedTab), selectTab]
}
