'use client'

import dynamic from 'next/dynamic'
import { AppHeader } from './AppHeader'
import { Fab } from './Fab'
import { StationDetailPanel } from './detail/StationDetailPanel'

// MapLibre は window 依存のため SSR 無効で client 限定ロード
const MapView = dynamic(() => import('./map/MapView').then((mod) => mod.MapView), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-slate-400">地図を読み込み中…</div>
  ),
})

/** アプリシェル：全面地図＋浮遊ヘッダ（ロゴ・検索・半径）＋左下 FAB。 */
export function MapShell() {
  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-50">
      <MapView />
      <AppHeader />
      <Fab />
      <StationDetailPanel />
    </main>
  )
}
