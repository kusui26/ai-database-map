'use client'

/**
 * ⤢ 拡大＝昇格（plan_fable §2.4 ルール③）。コンパクトカードを、クリックUIと同じ場所へ：
 * 駅詳細 → 右ドロワー（?grp＋焦点タブ）／ランキング・散布 → モーダル（PromotionHost が preset で開く）。
 */

import { useCallback } from 'react'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useChatStore } from '@/stores/chatStore'
import { type GroupPromotion } from './panelGroups'

export function usePromote(): (promotion: GroupPromotion) => void {
  const { setGrp } = useMapUrlState()
  const promote = useChatStore((state) => state.promote)
  const setRequestedCategory = useChatStore((state) => state.setRequestedCategory)

  return useCallback(
    (promotion: GroupPromotion) => {
      if (promotion.kind === 'detail') {
        setRequestedCategory(promotion.category) // ドロワーが開く際に読む（1 回消費）
        void setGrp(promotion.grp)
      } else {
        promote(promotion) // ranking | scatter → モーダル
      }
    },
    [setGrp, promote, setRequestedCategory],
  )
}
