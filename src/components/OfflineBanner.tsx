'use client'

/** オフライン通知（P7a）。切断中のみ上部にピルを出す。監視は `useIsOnline` が持つ。 */

import { useIsOnline } from '@/hooks/useIsOnline'

export function OfflineBanner() {
  const online = useIsOnline()

  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur">
        <span className="size-2 rounded-full bg-amber-400" aria-hidden />
        オフラインです — データを取得できない場合があります
      </div>
    </div>
  )
}
