'use client'

/**
 * 図の入れ物（広い画面のキャンバス・狭い画面のモーダル）の共通部分（2026-10-02）。
 *
 * - 中身（`RankingBody` / `ScatterBody`）は、図が**外から**変わったときだけ作り直す——
 *   戻る/進む、チャットの ⤢、AI の自動表示、FAB。作り直すと、新しい条件が初期値として入る
 * - 中身で条件を変えたら URL へ書き戻す（replace）。**書き戻しでは作り直さない**——
 *   作り直すと、表のスクロール位置や「もっと見る」で読み足した行が消える
 *
 * 外から変わったかは「中身がいま表している図」の鍵と URL の鍵を比べて決める。書き戻しは
 * URL を書く前に鍵を更新するので、自分の書き戻しを外からの変化と取り違えない。
 *
 * 比べるのは**レイアウト効果**で行う。中身は開いた直後に既定を補った条件を書き戻す（通常の効果）。
 * 通常の効果は子が先に走るため、入れ物も通常の効果で比べると、その書き戻しを外からの変化と
 * 取り違えて中身を作り直していた（開くたびに 2 回マウント・実測）。レイアウト効果は、どの通常の効果より先に走る。
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { figureKey, type Figure } from './url'
import { useFigureUrl } from './useFigureUrl'

export type FigureHost = {
  /** 開いている図（開いていなければ null）。 */
  readonly figure: Figure | null
  /** 中身に付ける key（外から図が変わったときだけ変わる）。 */
  readonly bodyKey: number
  /** 中身が条件を変えたときに呼ぶ（開いた直後の既定の補完を含む）。 */
  readonly onConditions: (figure: Figure) => void
  /** 閉じる（push＝戻るで開き直せる）。 */
  readonly close: () => void
}

export function useFigureHost(): FigureHost {
  const { figure, closeFigure, writeConditions } = useFigureUrl()
  const urlKey = figure === null ? null : figureKey(figure)
  // 中身がいま表している図。初期値は最初の描画の URL（深いリンクで開いたときに作り直さない）。
  const shownKey = useRef(urlKey)
  const [bodyKey, setBodyKey] = useState(0)

  useLayoutEffect(() => {
    const previous = shownKey.current
    if (urlKey === previous) return
    shownKey.current = urlKey
    // 閉じていた図を開くときは、中身は新しくマウントされる。作り直すのは、出ている図が替わるときだけ。
    if (previous !== null && urlKey !== null) setBodyKey((key) => key + 1)
  }, [urlKey])

  const onConditions = useCallback(
    (next: Figure) => {
      // 閉じたあとに中身から届いた書き戻しは捨てる（閉じた図を URL に戻さない）。
      if (shownKey.current === null) return
      shownKey.current = figureKey(next)
      writeConditions(next)
    },
    [writeConditions],
  )

  return { figure, bodyKey, onConditions, close: closeFigure }
}
