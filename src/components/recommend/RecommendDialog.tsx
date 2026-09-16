'use client'

/**
 * おすすめ駅のモーダル（FAB から開く）。枠だけを持ち、中身は `RecommendBody` に委ねる
 * （`RankingDialog` と同じ形）。
 *
 * ランキングより広い（`max-w-3xl`）のは、**順位に添えるもの**——候補集合・重みの凡例・
 * 内訳の帯・限界と出典——を同時に置くため。順位だけなら狭くてよいが、それは出さない。
 */

import { useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { RecommendBody } from './RecommendBody'

export function RecommendDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { setGrp } = useMapUrlState()
  // 駅を選んだら閉じる（背後の地図とドロワーを見せるため）。上位のハイライトは残る。
  const onSelect = useCallback(
    (grp: string) => {
      void setGrp(grp)
      onOpenChange(false)
    },
    [setGrp, onOpenChange],
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex h-[86vh] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">おすすめ駅</Dialog.Title>
            <Dialog.Close
              aria-label="閉じる"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          <RecommendBody active={open} onSelect={onSelect} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
