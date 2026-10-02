'use client'

/**
 * ⤢ 拡大＝昇格（plan_fable §2.4 ルール③）。コンパクトカードを、クリックUIと同じ場所へ：
 * 駅詳細 → 右ドロワー（?grp＋焦点タブ）／ランキング・散布 → 図（広い画面はキャンバス、狭い画面はモーダル）。
 *
 * 焦点タブはタブ帯と同じ道（`useSelectDetailTab`＝URL の `?tab`）で書く。焦点が無い駅詳細
 * （`category: null`＝駅の概要）は**タブを触らない**——この端末で覚えたタブのまま開く。
 * ⤢ は利用者の操作なので、駅も図も履歴に積む（戻るで閉じられる・2026-10-02）。
 */

import { useCallback } from 'react'
import { detailTabFor } from '@/shared/constants'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useSelectDetailTab } from '@/components/detail/useDetailTab'
import { useFigureUrl } from '@/components/figure/useFigureUrl'
import { type PanelPromotion } from '@/shared/promotion'

export function usePromote(): (promotion: PanelPromotion) => void {
  const { setGrp } = useMapUrlState()
  const { openFigure } = useFigureUrl()
  const selectDetailTab = useSelectDetailTab()

  return useCallback(
    (promotion: PanelPromotion) => {
      if (promotion.kind !== 'detail') {
        openFigure(promotion) // ranking | scatter → キャンバス／モーダル
        return
      }
      // タブと駅を同じ tick で書く（nuqs が 1 回の URL 更新に束ねる＝ドロワーは最初から焦点のタブ）。
      if (promotion.category !== null) selectDetailTab(detailTabFor(promotion.category))
      void setGrp(promotion.grp)
    },
    [setGrp, openFigure, selectDetailTab],
  )
}
