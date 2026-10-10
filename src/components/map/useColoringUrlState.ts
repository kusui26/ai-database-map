'use client'

/**
 * 駅の色分けの条件（`?color=<指標>&colorIn=<エリア>`）を URL に双方向同期する（nuqs・2026-10-11 B5c・
 * `docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * ハザードの `?hz` と同じく、**共有でき、戻るで戻せる**。エリア（1〜4 つ）は `colorIn` を繰り返す——エリアの文字列は
 * `,`（範囲 `bbox:139.55,35.40,…`）を含むので区切り文字でつながない（共通 API の `area=…&area=…` と同じ形）。
 *
 * 書き方（知らない指標・エリア・数）の検証は共通 API（`GET /api/stations/classes`）がする。ここで黙って捨てると、
 * 壊れたリンクを開いた人に理由が届かない（凡例が API の理由を出し、✕ で消せる）。
 */

import { useCallback, useMemo, useRef } from 'react'
import { parseAsNativeArrayOf, parseAsString, useQueryStates, type HistoryOptions } from 'nuqs'
import { sameColoring } from '@/domain/style/coloring'
import { type StationColoring } from '@/shared/area-summary'

const coloringParsers = {
  color: parseAsString,
  colorIn: parseAsNativeArrayOf(parseAsString),
}

export type ColoringUrlState = {
  /** 色分けの条件（URL に `color` が無ければ null）。 */
  readonly coloring: StationColoring | null
  /**
   * 条件を書く（null＝消す）。利用者の操作（凡例の ✕）は push＝戻るで戻せる。
   * AI の回答は「1 回の回答で 1 履歴」に合わせて `history` を渡す（`chat/answerHistory.ts`）。
   */
  readonly setColoring: (next: StationColoring | null, history?: HistoryOptions) => void
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** エリアの並びを 1 つの文字列にして比べる（nuqs は描画のたびに新しい配列を返すことがある）。 */
function areasFrom(areasJson: string): string[] {
  const parsed: unknown = JSON.parse(areasJson)
  return isStringArray(parsed) ? parsed : []
}

export function useColoringUrlState(): ColoringUrlState {
  const [state, setState] = useQueryStates(coloringParsers)
  const { color } = state
  // URL が変わらない限り同一参照（地図の描き直しと取得のキーに使う）。
  const areasJson = JSON.stringify(state.colorIn)
  const coloring = useMemo(
    (): StationColoring | null =>
      color === null ? null : { metricKey: color, areas: areasFrom(areasJson) },
    [color, areasJson],
  )
  // 最後に書いた条件。同じ条件を書き直さない（同じ URL の履歴を積まない・`selection.ts` と同じ考え）。
  const latest = useRef<StationColoring | null>(coloring)
  latest.current = coloring
  const setColoring = useCallback(
    (next: StationColoring | null, history: HistoryOptions = 'push'): void => {
      if (sameColoring(latest.current, next)) return
      latest.current = next
      void setState(
        next === null
          ? { color: null, colorIn: null }
          : { color: next.metricKey, colorIn: [...next.areas] },
        { history },
      )
    },
    [setState],
  )
  return { coloring, setColoring }
}
