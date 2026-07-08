'use client'

import { useEffect, useState } from 'react'

/** Tailwind sm（既定 640px）以上か。マウント後に matchMedia で判定する（初期値＝デスクトップ）。 */
export function useIsDesktop(breakpointPx = 640): boolean {
  const [isDesktop, setIsDesktop] = useState(true)

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${breakpointPx}px)`)
    const update = () => setIsDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [breakpointPx])

  return isDesktop
}
