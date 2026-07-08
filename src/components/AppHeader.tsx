'use client'

import { RadiusControl } from './RadiusControl'
import { StationSearch } from './StationSearch'

/** 浮遊ヘッダ：ロゴ・駅名検索・半径セグメント。モバイルは縦積み（375px でも崩れない）。 */
export function AppHeader() {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
      <div className="pointer-events-auto flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 rounded-xl bg-white/90 px-3 py-2.5 shadow-lg ring-1 ring-slate-200 backdrop-blur">
            <span className="size-2 rounded-full bg-indigo-600" aria-hidden />
            <span className="hidden text-sm font-semibold text-slate-900 sm:inline">
              AI Database Map
            </span>
          </div>
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <StationSearch />
          </div>
        </div>
        <div className="shrink-0 overflow-x-auto sm:ml-auto">
          <RadiusControl />
        </div>
      </div>
    </header>
  )
}
