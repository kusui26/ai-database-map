'use client'

/**
 * エリアの図のモーダル（2026-10-15 B5e）。**狭い画面・携帯で図を出す入れ物**（FAB・チャットの ⤢・URL の `?fig=area`。
 * 広い画面ではキャンバスの列が同じ図を出す・`chat/PromotionHost.tsx`）。枠（オーバーレイ・ヘッダ・閉じる）だけを持ち、
 * 中身は `AreaBody` に委ねる。地図の色分けは図が書くので、閉じると背後の地図に色分けが見える。
 */

import * as Dialog from '@radix-ui/react-dialog'
import { type AreaFigure } from '@/components/figure/url'
import { AreaBody } from './AreaBody'

export function AreaDialog({
  open,
  onOpenChange,
  initial,
  onConditions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 開いた図（条件の初期値・`figure/url.ts`）。 */
  initial: AreaFigure
  /** 中身が条件を変えたら呼ぶ（入れ物が URL へ書き戻す）。 */
  onConditions?: (figure: AreaFigure) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex h-[86vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">エリア</Dialog.Title>
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

          <AreaBody initial={initial} active={open} onConditions={onConditions} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
