'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chatStore'
import { RadiusControl } from './RadiusControl'
import { StationSearch } from './StationSearch'

// About は初回オープンまで読み込まない（初期バンドルから外す）。
const AboutDialog = dynamic(() => import('./AboutDialog').then((m) => m.AboutDialog))

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" strokeLinecap="round" />
      <path d="M12 7.75h.01" strokeLinecap="round" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2Z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" />
    </svg>
  )
}

/** ✦AI トグル（チャット開閉）。⌘K / Ctrl+K でも開閉。 */
function ChatToggle() {
  const open = useChatStore((state) => state.open)
  const toggle = useChatStore((state) => state.toggle)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={open}
      aria-label="AI チャットを開閉（⌘K）"
      title="AI チャット（⌘K）"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium shadow-lg ring-1 backdrop-blur transition-colors',
        open
          ? 'bg-indigo-600 text-white ring-indigo-600'
          : 'bg-white/90 text-slate-700 ring-slate-200 hover:bg-white',
      )}
    >
      <SparkleIcon />
      <span className="hidden sm:inline">AI</span>
    </button>
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
        <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
          <div className="overflow-x-auto">
            <RadiusControl />
          </div>
          <ChatToggle />
        </div>
      </div>
      {aboutSeen && <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />}
    </header>
  )
}
