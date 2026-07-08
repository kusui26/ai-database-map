'use client'

import { useMapStore } from '@/stores/mapStore'

/** ホバー中の駅名を、カーソル位置の上に小さく表示する。 */
export function HoverTooltip() {
  const hovered = useMapStore((state) => state.hovered)
  if (hovered === null || hovered.name === '') return null
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-slate-900/85 px-2 py-1 text-xs font-medium text-white shadow-lg"
      style={{ left: hovered.x, top: hovered.y - 10 }}
    >
      {hovered.name}
    </div>
  )
}
