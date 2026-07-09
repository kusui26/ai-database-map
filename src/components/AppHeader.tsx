'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { RadiusControl } from './RadiusControl'
import { StationSearch } from './StationSearch'

// About は初回オープンまで読み込まない（初期バンドルから外す）。
const AboutDialog = dynamic(() => import('./AboutDialog').then((m) => m.AboutDialog))

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" strokeLinecap="round" />
      <path d="M12 7.75h.01" strokeLinecap="round" />
    </svg>
  )
}

/** 浮遊ヘッダ：ロゴ・About・駅名検索・半径セグメント。モバイルは縦積み（375px でも崩れない）。 */
export function AppHeader() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const [aboutSeen, setAboutSeen] = useState(false)
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
      <div className="pointer-events-auto flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 rounded-xl bg-white/90 px-3 py-2.5 shadow-lg ring-1 ring-slate-200 backdrop-blur">
            <span className="size-2 rounded-full bg-indigo-600" aria-hidden />
            <span className="hidden text-sm font-semibold text-slate-900 sm:inline">
              AI Database Map
            </span>
            <button
              type="button"
              onClick={() => {
                setAboutSeen(true)
                setAboutOpen(true)
              }}
              aria-label="このアプリ・データ出典について"
              title="このアプリ・データ出典について"
              className="-mr-1 rounded-md p-0.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <InfoIcon />
            </button>
          </div>
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <StationSearch />
          </div>
        </div>
        <div className="shrink-0 overflow-x-auto sm:ml-auto">
          <RadiusControl />
        </div>
      </div>
      {aboutSeen && <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />}
    </header>
  )
}
