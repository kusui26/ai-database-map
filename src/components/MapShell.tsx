'use client'

import dynamic from 'next/dynamic'
import { AppHeader } from './AppHeader'
import { Fab } from './Fab'
import { OfflineBanner } from './OfflineBanner'

// MapLibre は window 依存＋大きいため、SSR 無効の別チャンクで client 限定ロード
// （メインバンドルに載せるとハイドレーションを阻害し TBT/LCP が悪化する）。
const MapView = dynamic(() => import('./map/MapView').then((mod) => mod.MapView), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-slate-400">地図を読み込み中…</div>
  ),
})

// 駅詳細（PanelRenderer 経由で Chart.js を含む）は初期クリティカルバンドルから外す。
const StationDetailPanel = dynamic(
  () => import('./detail/StationDetailPanel').then((mod) => mod.StationDetailPanel),
  { ssr: false },
)

/** アプリシェル：全面地図＋浮遊ヘッダ（ロゴ・検索・半径）＋左下 FAB。 */
export function MapShell() {
  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-50">
      <MapView />
      <AppHeader />
      <OfflineBanner />
      <Fab />
      <StationDetailPanel />
    </main>
  )
}
