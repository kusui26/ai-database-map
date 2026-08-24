'use client'

/**
 * 表示中のハザードレイヤ（`?hz`）と不透明度（`?hzop`）を URL に双方向同期する（nuqs）。
 *
 * 既存の `?grp` `?r` と同じ流儀。**共有リンクで「この危険な区域を見て」が送れる**のは
 * 防災用途で本当に効く（docs/260824_flood.md §7.1）。
 * 生の key はそのまま信じず、必ずドメインの `resolveHazardLayerKeys` を通す
 * （実在しない key を落とし、重複を畳み、カタログ順に並べ直す）。
 */

import { useCallback, useMemo } from 'react'
import { parseAsFloat, parseAsString, useQueryState } from 'nuqs'
import { clampHazardOpacity, HAZARD_OPACITY_DEFAULT } from '@/shared/constants'
import { resolveHazardLayerKeys, toggleHazardLayer } from '@/domain/hazard/catalog'

/** `?hz` の区切り（URL でそのまま読める文字にする）。 */
const SEPARATOR = ','

export type HazardUrlState = {
  /** 表示中のレイヤ key（カタログ順・実在するものだけ）。 */
  readonly layerKeys: readonly string[]
  /** 不透明度（0.3–0.9 に丸め済み）。 */
  readonly opacity: number
  /** 1 レイヤの ON/OFF（同じグループで base は 1 つだけ、というルールはドメインが持つ）。 */
  readonly toggleLayer: (key: string) => void
  /** まとめて差し替え（チャットの `setHazardLayers` から使う）。 */
  readonly setLayerKeys: (keys: readonly string[]) => void
  readonly setOpacity: (value: number) => void
}

export function useHazardUrlState(): HazardUrlState {
  const [rawKeys, setRawKeys] = useQueryState('hz', parseAsString.withDefault(''))
  const [rawOpacity, setRawOpacity] = useQueryState(
    'hzop',
    parseAsFloat.withDefault(HAZARD_OPACITY_DEFAULT),
  )

  // 文字列から導出するので、rawKeys が変わらない限り同一参照（useEffect の依存に使える）。
  const layerKeys = useMemo(() => resolveHazardLayerKeys(rawKeys.split(SEPARATOR)), [rawKeys])
  const opacity = clampHazardOpacity(rawOpacity)

  const setLayerKeys = useCallback(
    (keys: readonly string[]) => {
      const resolved = resolveHazardLayerKeys(keys)
      // 空なら ?hz ごと消す（既定状態の URL を汚さない）。
      void setRawKeys(resolved.length === 0 ? null : resolved.join(SEPARATOR))
    },
    [setRawKeys],
  )

  const toggleLayer = useCallback(
    (key: string) => setLayerKeys(toggleHazardLayer(layerKeys, key)),
    [layerKeys, setLayerKeys],
  )

  const setOpacity = useCallback(
    (value: number) => {
      const clamped = clampHazardOpacity(value)
      void setRawOpacity(clamped === HAZARD_OPACITY_DEFAULT ? null : clamped)
    },
    [setRawOpacity],
  )

  return { layerKeys, opacity, toggleLayer, setLayerKeys, setOpacity }
}
