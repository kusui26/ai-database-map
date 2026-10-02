'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Tailwind sm（既定 640px）以上か。
 *
 * サーバの描画と水和（hydration）の間は「デスクトップ」と答え（サーバは画面幅を知らない）、
 * それ以外は matchMedia の今の値を返す。水和のあとに初めてマウントする部品（初めて開く図・
 * 初めて選んだ駅の詳細）は、最初の描画から正しい形で出る。以前は `useState(true)`＋効果で判定して
 * いたため、携帯で 1 フレームだけデスクトップの形（キャンバス・右ドロワー）が描かれていた（2026-10-02 実測）。
 */
export function useIsDesktop(breakpointPx = 640): boolean {
  const query = `(min-width: ${breakpointPx}px)`
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot, isDesktopOnServer)
}

/** サーバと水和では幅が分からないので、デスクトップとして描く（以前の初期値と同じ）。 */
function isDesktopOnServer(): boolean {
  return true
}
