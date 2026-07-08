'use client'

import { RADII_M, RADIUS_LABELS } from '@/shared/constants'
import { useMapUrlState } from './map/useMapUrlState'

/** 半径セグメント（?r 同期）。選択駅の半径サークルが即時更新される。 */
export function RadiusControl() {
  const { radiusM, setRadiusM } = useMapUrlState()
  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-white/90 p-1 shadow-lg ring-1 ring-slate-200 backdrop-blur">
      {RADII_M.map((radius) => (
        <button
          key={radius}
          type="button"
          onClick={() => void setRadiusM(radius)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium tabular-nums transition ${
            radius === radiusM ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {RADIUS_LABELS[radius]}
        </button>
      ))}
    </div>
  )
}
