'use client'

/**
 * 会話の中に出す図（狭い画面・携帯・2026-10-02・`docs/261001_fix_user_feedback_ui.md` §4.4(b)）。
 *
 * サーバが組んだ compact のパネルを、そのまま会話の中に描く（描画は `PanelStack`・新しい描画コードは無い）。
 * ⤢「拡大」で、クリックの UI と同じ場所へ広げる——ランキング・散布はモーダル、駅詳細は駅詳細（携帯はシート）。
 * 順位表の行・散布の点を押すと、その駅を選ぶ（利用者の操作なので、携帯でも駅詳細のシートが開く）。
 *
 * 260802 に図をキャンバスへ移すまで使っていたインラインカード（P8b）と同じ形。
 * どの幅で会話の中に出すかは `presentation.ts` が決める。
 */

import { type PanelPromotion } from '@/shared/promotion'
import { PanelStack } from '@/components/panels/PanelRenderer'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { type PanelGroup } from './panelGroups'
import { ExpandIcon, chipLabel } from './PanelChip'
import { usePromote } from './usePromote'

export function InlineFigure({
  group,
  promotion,
}: {
  group: PanelGroup
  promotion: PanelPromotion
}) {
  const { setGrp } = useMapUrlState()
  const promote = usePromote()
  const expandLabel = `${chipLabel(group.panels, promotion)} を拡大`

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <div className="p-3">
        <PanelStack panels={group.panels} onSelect={(grp) => void setGrp(grp)} />
      </div>
      <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-2 py-1">
        <button
          type="button"
          onClick={() => promote(promotion)}
          aria-label={expandLabel}
          title={expandLabel}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <ExpandIcon />
          拡大
        </button>
      </div>
    </div>
  )
}
