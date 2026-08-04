'use client'

import { type ReactNode, useState } from 'react'
import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { useChatStore } from '@/stores/chatStore'
import { useMapStore } from '@/stores/mapStore'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { usePrefetchOnIdle } from '@/hooks/usePrefetchOnIdle'
// 初期バンドルから外す：ダイアログ（散布は Chart.js を含む）は初回オープンまで読み込まない。
// 遅延ロードの定義は共通モジュールに置く（Suspense 境界の付け忘れを 1 か所に閉じ込めるため）。
import { DIALOG_LOADERS, RankingDialog, ScatterDialog } from './lazyDialogs'

/** FAB とチャットパネルのあいだの余白。 */
const FAB_GAP_PX = 8
/** チャットを開いているときの FAB の左端（パネル幅から算出・260804）。 */
const FAB_LEFT_WITH_CHAT_PX = PANEL_GAP_PX + PANEL_WIDTH_PX + FAB_GAP_PX

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

/** 左下 FAB（ランキング＝P6a／散布図＝P6b）。ダイアログは初回オープンで初めてマウント（遅延ロード）。 */
export function Fab() {
  const [rankingOpen, setRankingOpen] = useState(false)
  const [scatterOpen, setScatterOpen] = useState(false)
  // 一度開いたら以後もマウントし続ける（初回のみチャンク取得・状態は保持）。
  const [rankingSeen, setRankingSeen] = useState(false)
  const [scatterSeen, setScatterSeen] = useState(false)
  // デスクトップでチャットを開くと FAB が左パネルに隠れるため右へ寄せる（位置はパネル幅から算出）。
  const chatOpen = useChatStore((state) => state.open)
  const isDesktop = useIsDesktop()
  const shifted = isDesktop && chatOpen
  // クリック後にチャンク取得を待たせないため、地図が出たあとのアイドル時間に先読みしておく。
  // 地図の準備完了を待つのは、早く始めると地図の取得と帯域を奪い合って LCP が悪化するため。
  const mapReady = useMapStore((state) => state.ready)
  usePrefetchOnIdle(DIALOG_LOADERS, mapReady)
  return (
    <>
      <div
        style={shifted ? { left: FAB_LEFT_WITH_CHAT_PX } : undefined}
        className="pointer-events-auto absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2 transition-[left] duration-300 sm:left-4 sm:translate-x-0"
      >
        <FabButton
          icon={<TrophyIcon />}
          label="ランキング"
          onClick={() => {
            setRankingSeen(true)
            setRankingOpen(true)
          }}
        />
        <FabButton
          icon={<ScatterIcon />}
          label="散布図"
          onClick={() => {
            setScatterSeen(true)
            setScatterOpen(true)
          }}
        />
      </div>
      {rankingSeen && <RankingDialog open={rankingOpen} onOpenChange={setRankingOpen} />}
      {scatterSeen && <ScatterDialog open={scatterOpen} onOpenChange={setScatterOpen} />}
    </>
  )
}
