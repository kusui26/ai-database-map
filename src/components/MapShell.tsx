'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useChatStore } from '@/stores/chatStore'
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

// チャット（Step2・@ai-sdk/react を含む）は初回オープンまで読み込まない。
const ChatPanel = dynamic(() => import('./chat/ChatPanel').then((mod) => mod.ChatPanel), {
  ssr: false,
})
const PromotionHost = dynamic(
  () => import('./chat/PromotionHost').then((mod) => mod.PromotionHost),
  { ssr: false },
)

/** アプリシェル：全面地図＋浮遊ヘッダ（ロゴ・検索・半径・✦AI）＋左下 FAB＋左チャット。 */
export function MapShell() {
  const chatOpen = useChatStore((state) => state.open)
  const setChatOpen = useChatStore((state) => state.setOpen)
  const [chatSeen, setChatSeen] = useState(false)

  // 初回ロード時、デスクトップ幅ならチャットを既定オープン（P8d 案B）。
  // モバイルは既定クローズ＝地図の初見を優先し、ChatPanel の遅延ロードを維持（mobile LCP に影響なし）。
  useEffect(() => {
    if (window.matchMedia('(min-width: 640px)').matches) setChatOpen(true)
  }, [setChatOpen])

  useEffect(() => {
    if (chatOpen) setChatSeen(true)
  }, [chatOpen])

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-50">
      <MapView />
      <AppHeader />
      <OfflineBanner />
      <Fab />
      <StationDetailPanel />
      {chatSeen && <ChatPanel />}
      {chatSeen && <PromotionHost />}
    </main>
  )
}
