'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useChatStore } from '@/stores/chatStore'
import { useMapUrlState } from './map/useMapUrlState'
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
// キャンバス（回答の図）は、図が出るまで読み込まない＝初期表示は地図のまま（260802）。
const ChatCanvas = dynamic(() => import('./canvas/ChatCanvas').then((mod) => mod.ChatCanvas), {
  ssr: false,
})

/** アプリシェル：全面地図＋浮遊ヘッダ（ロゴ・検索・半径・✦AI）＋左下 FAB＋左チャット＋キャンバス。 */
export function MapShell() {
  const chatOpen = useChatStore((state) => state.open)
  const setChatOpen = useChatStore((state) => state.setOpen)
  const { grp } = useMapUrlState()
  const promotion = useChatStore((state) => state.promotion)
  const [chatSeen, setChatSeen] = useState(false)
  // 駅詳細と図の表示先（キャンバス／モーダル）は「何も出さない状態」でも重い依存
  // （Chart.js・メトリクスカタログ）を連れてくる。初回に必要になるまでマウントしない
  // ＝初期表示で読み込まない（260803・§4-③）。
  // 一度出したら以後は保持する（閉じるアニメーションと内部状態を壊さない）。
  const [detailSeen, setDetailSeen] = useState(false)
  const [promotionSeen, setPromotionSeen] = useState(false)

  // 初回ロード時、デスクトップ幅ならチャットを既定オープン（P8d 案B）。
  // モバイルは既定クローズ＝地図の初見を優先し、ChatPanel の遅延ロードを維持（mobile LCP に影響なし）。
  useEffect(() => {
    if (window.matchMedia('(min-width: 640px)').matches) setChatOpen(true)
  }, [setChatOpen])

  useEffect(() => {
    if (chatOpen) setChatSeen(true)
  }, [chatOpen])

  useEffect(() => {
    if (grp !== null) setDetailSeen(true)
  }, [grp])

  useEffect(() => {
    if (promotion !== null) setPromotionSeen(true)
  }, [promotion])

  // 重なり順（この main の直下は同じ重なり文脈にいるので、ここで一覧にしておく）:
  //   z-10  地図の付随物（FAB・ホバーツールチップ）
  //   z-20  浮遊パネル（AI チャット・駅詳細・キャンバス）
  //   z-30  ヘッダと通信断バナー ← 駅名検索の候補がパネルの前に出る必要がある
  //   z-40  モーダルのオーバーレイ／z-50 モーダル本体（Radix・Vaul の portal）
  // ヘッダは `z-30` で重なり文脈を作るため、中の候補リストは何を指定してもヘッダより
  // 前には出られない。したがって「候補を前に出す」＝ヘッダ自体をパネルより上げる、が正解。
  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-50">
      <MapView />
      <AppHeader />
      <OfflineBanner />
      <Fab />
      {detailSeen && <StationDetailPanel />}
      {chatSeen && <ChatPanel />}
      {promotionSeen && <PromotionHost />}
      {promotionSeen && <ChatCanvas />}
    </main>
  )
}
