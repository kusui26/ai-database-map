'use client'

/**
 * 散布図のモーダル（FAB から開く／narrow でのチャット昇格先）。
 * 枠（オーバーレイ・ヘッダ・閉じる）だけを持ち、中身は `ScatterBody` に委ねる。
 * 同じ中身をチャットのキャンバスでも使う（docs/260802_ai_chat_canvs.md §2.1）。
 */

import { useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { ScatterBody, type ScatterInitial } from './ScatterBody'

export function ScatterDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ScatterInitial
}) {
  const { setGrp } = useMapUrlState()
  // モーダルでは駅を選んだら閉じる（背後の地図・ドロワーを見せるため）。
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
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">散布図</Dialog.Title>
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

          <ScatterBody initial={initial} active={open} onSelect={onSelect} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
