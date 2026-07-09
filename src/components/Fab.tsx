'use client'

import { type ReactNode, useState } from 'react'
import { RankingDialog } from './ranking/RankingDialog'

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-4">
      <path
        d="M7 4h10v3a5 5 0 0 1-10 0V4Z M7 5H4v1a3 3 0 0 0 3 3 M17 5h3v1a3 3 0 0 1-3 3 M9 12v3m6-3v3M8 20h8m-6 0 .5-2.5h3L14 20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ScatterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-4">
      <path d="M4 20V4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path
        d="M4 20h16"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="8" cy="14" r="1.4" />
      <circle cx="12" cy="9" r="1.4" />
      <circle cx="16" cy="12" r="1.4" />
      <circle cx="18" cy="7" r="1.4" />
    </svg>
  )
}

function FabButton({
  icon,
  label,
  onClick,
  title,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className="inline-flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-sm font-medium text-slate-700 shadow-lg ring-1 ring-slate-200 backdrop-blur transition hover:bg-white"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

/** 左下 FAB（ランキング＝P6a 実装／散布図＝P6b プレースホルダ）。 */
export function Fab() {
  const [rankingOpen, setRankingOpen] = useState(false)
  return (
    <>
      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2 sm:left-4 sm:translate-x-0">
        <FabButton icon={<TrophyIcon />} label="ランキング" onClick={() => setRankingOpen(true)} />
        <FabButton icon={<ScatterIcon />} label="散布図" title="準備中（P6b で実装）" />
      </div>
      <RankingDialog open={rankingOpen} onOpenChange={setRankingOpen} />
    </>
  )
}
