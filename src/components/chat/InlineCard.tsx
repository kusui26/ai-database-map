'use client'

/**
 * チャットスレッド内のインラインカード（plan_fable §2.4 ルール②③）。
 * 効果グループ（駅詳細／ランキング／散布）を **既存の PanelStack** で compact 描画し（新規描画コードなし）、
 * ⤢ でクリックUIと同じ場所（ドロワー/モーダル）へ昇格する。ランキング行・散布点は onSelect で駅選択。
 */

import { type PanelGroup } from './panelGroups'
import { PanelStack } from '@/components/panels/PanelRenderer'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { usePromote } from './usePromote'

function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function InlineCard({ group }: { group: PanelGroup }) {
  const { setGrp } = useMapUrlState()
  const promote = usePromote()
  const promotion = group.promotion

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <div className="max-h-96 overflow-y-auto p-3">
        <PanelStack panels={group.panels} onSelect={(grp) => void setGrp(grp)} />
      </div>
      {promotion !== null && (
        <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-2 py-1">
          <button
            type="button"
            onClick={() => promote(promotion)}
            aria-label="拡大して表示"
            title="拡大して表示"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ExpandIcon />
            拡大
          </button>
        </div>
      )}
    </div>
  )
}
