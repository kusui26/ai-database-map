'use client'

import { type ReactNode } from 'react'

/** エリアの選び方の「決める」ボタン（右に寄せる・選べないときは押せない）。 */
export function SubmitButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {children}
      </button>
    </div>
  )
}
