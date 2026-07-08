'use client'

import dynamic from 'next/dynamic'
import { RadiusControl } from './RadiusControl'

// MapLibre は window 依存のため SSR 無効で client 限定ロード
const MapView = dynamic(() => import('./map/MapView').then((mod) => mod.MapView), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-slate-400">地図を読み込み中…</div>
  ),
})

/** アプリシェル（P4a：全面地図＋浮遊ヘッダ＋半径セグメント。検索は P4b）。 */
export function MapShell() {
  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-50">
      <MapView />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-sm font-semibold text-slate-900 shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <span className="size-2 rounded-full bg-indigo-600" aria-hidden />
          AI Database Map
        </span>
        <div className="pointer-events-auto">
          <RadiusControl />
        </div>
      </header>
    </main>
  )
}
