'use client'

import { useEffect, useState } from 'react'

/**
 * 「視差効果を減らす」（`prefers-reduced-motion: reduce`）の設定か。マウント後に matchMedia で判定し、
 * 設定の切り替えにも追随する（初期値＝減らさない）。なめらかなスクロールを一度に送る判断に使う。
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return reduced
}
