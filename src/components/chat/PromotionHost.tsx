'use client'

/**
 * ⤢ 昇格のうち「ランキング／散布」をクリックUIと同じモーダルで開く（plan_fable §2.4 ルール③）。
 * chatStore.promotion を preset にして既存ダイアログを開く（key=seq で毎回初期化）。
 * 駅詳細の昇格は usePromote が ?grp＋焦点タブで右ドロワーを開くため、ここでは扱わない。
 *
 * 260802：**広い画面ではキャンバス（ChatCanvas）が同じ promotion を担当する**ので、
 * ここは narrow・モバイルだけを受け持つ（同じ図が二重に出ないようにする）。
 */

import dynamic from 'next/dynamic'
import { useChatStore } from '@/stores/chatStore'
import { useIsWide } from '@/hooks/useIsWide'

const RankingDialog = dynamic(() =>
  import('@/components/ranking/RankingDialog').then((module) => module.RankingDialog),
)
const ScatterDialog = dynamic(() =>
  import('@/components/scatter/ScatterDialog').then((module) => module.ScatterDialog),
)

export function PromotionHost() {
  const promotion = useChatStore((state) => state.promotion)
  const seq = useChatStore((state) => state.promotionSeq)
  const clear = useChatStore((state) => state.clearPromotion)
  const isWide = useIsWide()

  if (isWide || promotion === null) return null

  if (promotion.kind === 'ranking') {
    return (
      <RankingDialog
        key={seq}
        open
        onOpenChange={(next) => {
          if (!next) clear()
        }}
        initial={{
          metricKey: promotion.metricKey,
          prefectures: promotion.prefectures,
          operators: promotion.operators,
          routes: promotion.routes,
          routeTypes: promotion.routeTypes,
          order: promotion.order,
          excludeLowN: promotion.excludeLowN,
        }}
      />
    )
  }

  return (
    <ScatterDialog
      key={seq}
      open
      onOpenChange={(next) => {
        if (!next) clear()
      }}
      initial={{
        xKey: promotion.xKey,
        yKey: promotion.yKey,
        prefectures: promotion.prefectures,
        operators: promotion.operators,
        routes: promotion.routes,
        routeTypes: promotion.routeTypes,
        excludeLowN: promotion.excludeLowN,
      }}
    />
  )
}
