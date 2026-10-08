'use client'

/** 開いている間、ボタンの位置からポップオーバーのずれと幅を決める（画面の幅が変われば測り直す・2026-10-08 L4）。 */

import { type CSSProperties, type RefObject, useLayoutEffect, useState } from 'react'
import { type PopoverPlacement, popoverPlacement } from './popoverPlacement'

/** ポップオーバーに当てる位置（測る前は className の既定＝ボタンの左端から）。 */
export function placementStyle(placement: PopoverPlacement | null): CSSProperties | undefined {
  return placement === null ? undefined : { left: placement.offset_px, width: placement.width_px }
}

export function usePopoverPlacement(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  preferredWidth_px: number,
): PopoverPlacement | null {
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const element = anchor.current
      if (element === null) return
      const left_px = element.getBoundingClientRect().left
      setPlacement(popoverPlacement(left_px, window.innerWidth, preferredWidth_px))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, anchor, preferredWidth_px])
  return open ? placement : null
}
