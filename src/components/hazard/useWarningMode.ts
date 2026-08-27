'use client'

/**
 * 警戒モードの既定レイヤ切替（`docs/260824_flood.md` §7.4）。
 *
 * 警戒レベル3相当以上が出ている地域を見ているとき、**キキクル（いまの危険度）＋想定区域**を
 * 自動で出す。どのレイヤを出すかはドメイン（`warning-mode`）が決め、ここは
 * 「いつ入れ替えてよいか」だけを持つ。
 *
 * ## 利用者の選択は絶対に奪わない
 *
 * 自動で入れるのは **`?hz` が空のとき（＝まだ誰も何も選んでいないとき）だけ**。
 * さらに、**一度入れたら二度と自動で触らない**——自動で入ったレイヤを利用者が消した直後に
 * また戻ってきたら、地図が言うことを聞かない道具になる。
 *
 * 発表が終わっても**自動では消さない**。消えたことに気づかず「もう安全」と読ませるより、
 * 出したままにして利用者に閉じてもらう方が安全側である。
 */

import { useEffect, useRef } from 'react'
import { warningModeLayers, isWarningMode } from '@/domain/hazard/warning-mode'
import type { HazardAlertsResponse } from '@/shared/api'

export type WarningModeInput = {
  readonly alerts: HazardAlertsResponse | undefined
  /** いま表示中のレイヤ（`?hz`）。 */
  readonly layerKeys: readonly string[]
  readonly setLayerKeys: (keys: readonly string[]) => void
}

/** 警戒中で、まだ何も選ばれていなければ、既定レイヤを 1 度だけ入れる。 */
export function useWarningMode({ alerts, layerKeys, setLayerKeys }: WarningModeInput): void {
  const applied = useRef(false)
  // 効果の中から常に最新を読む（依存に入れると、レイヤを触るたびに再実行される）。
  const latest = useRef({ layerKeys, setLayerKeys })
  latest.current = { layerKeys, setLayerKeys }

  const warning = alerts !== undefined && isWarningMode(alerts.alertLevel)
  const warnings = alerts?.warnings
  const hasFlood = (alerts?.floodForecasts.length ?? 0) > 0

  useEffect(() => {
    if (!warning || applied.current || warnings === undefined) return
    if (latest.current.layerKeys.length > 0) return
    applied.current = true
    latest.current.setLayerKeys(warningModeLayers(warnings, hasFlood))
  }, [warning, warnings, hasFlood])
}
