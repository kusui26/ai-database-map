'use client'

/**
 * 現在地の災害リスク（`docs/260824_flood.md` §8.3・§7.3）。
 *
 * 中身は `hazardCard` パネル 1 枚だけ——**チャットが返すのと同じもの**を描く。
 * だからここには意味づけを書かない（危険度も文言も出典もサーバが決めている）。
 *
 * この画面が守ること。
 * - **測れないときも黙らない**。権限拒否・測位不能・時間切れで**理由ごとに**言い方を変える
 * - **精度を必ず見せる**（誤差 ±◯m）。250m メッシュより粗いこともある（§11 リスク 3）
 * - **オフラインでも出す**。通信できなければ端末のメッシュだけで組み立てる（`useCurrentPositionHazard`）
 */

import { useEffect, useRef } from 'react'
import { Drawer } from 'vaul'
import { PANEL_GAP_PX, PANEL_WIDTH_CSS, PANEL_WIDTH_PX } from '@/shared/constants'
import { hazardCardPanel } from '@/domain/hazard/panels'
import { useChatStore } from '@/stores/chatStore'
import { useGeoStore, type CurrentPosition, type GeoStatus } from '@/stores/geoStore'
import { useMapStore } from '@/stores/mapStore'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { PanelRenderer } from '@/components/panels/PanelRenderer'
import { useCurrentPositionHazard } from './useCurrentPositionHazard'
import { cn } from '@/lib/utils'

/** デスクトップでチャットを開いているときの左端（FAB と同じ規則）。 */
const LEFT_WITH_CHAT_PX = PANEL_GAP_PX + PANEL_WIDTH_PX + 8
/** 測位が古いと見なす時間（この UI では「◯分前の位置」と添える）。 */
const STALE_MS = 60_000

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="現在地を閉じる"
      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/** 測位の精度と鮮度（**どれだけ確からしい位置か**を数字で見せる）。 */
function Accuracy({ position }: { position: CurrentPosition }) {
  const age = Date.now() - position.at
  return (
    <p className="text-xs text-slate-400">
      誤差 ±{Math.round(position.accuracyM)}m
      {age > STALE_MS && `・${Math.round(age / STALE_MS)} 分前の位置`}
      {position.accuracyM > 250 && (
        <span className="ml-1 text-amber-600">（250m メッシュより粗い精度です）</span>
      )}
    </p>
  )
}

/** 測れないときの案内。**理由ごとに、できることを書く。** */
function Unavailable({ status, errorJa }: { status: GeoStatus; errorJa: string | null }) {
  if (status === 'locating') {
    return <p className="py-6 text-center text-sm text-slate-400">現在地を取得しています…</p>
  }
  return (
    <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
      {errorJa ?? '現在地を取得できませんでした。'}
    </div>
  )
}

/** 現在地に寄せるズーム。250m メッシュ 1 枚が画面に収まるくらい。 */
const FOCUS_ZOOM = 15

function PanelBody({ onClose }: { onClose: () => void }) {
  const position = useGeoStore((state) => state.position)
  const status = useGeoStore((state) => state.status)
  const errorJa = useGeoStore((state) => state.errorJa)
  const requestFlyTo = useMapStore((state) => state.requestFlyTo)
  const { point, isLoading } = useCurrentPositionHazard(position)

  // 開いてから**最初の 1 点だけ**地図を寄せる。GPS が揺れるたびに動かすと地図が使えない。
  const flown = useRef(false)
  useEffect(() => {
    if (position === null || flown.current) return
    flown.current = true
    requestFlyTo({ lon: position.lon, lat: position.lat, zoom: FOCUS_ZOOM })
  }, [position, requestFlyTo])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">現在地の災害リスク</h2>
          {position !== null && <Accuracy position={position} />}
        </div>
        <CloseButton onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {position === null ? (
          <Unavailable status={status} errorJa={errorJa} />
        ) : point === undefined ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {isLoading ? '災害リスクを調べています…' : '結果を取得できませんでした。'}
          </p>
        ) : (
          <PanelRenderer panel={hazardCardPanel(point, 'compact')} />
        )}
      </div>
    </div>
  )
}

/** 現在地パネル。デスクトップ＝左下の浮遊カード／モバイル＝ボトムシート。 */
export function CurrentPositionPanel() {
  const active = useGeoStore((state) => state.active)
  const stop = useGeoStore((state) => state.stop)
  const chatOpen = useChatStore((state) => state.open)
  const isDesktop = useIsDesktop()

  if (isDesktop) {
    return (
      <aside
        inert={!active}
        aria-hidden={!active}
        style={{
          width: PANEL_WIDTH_CSS,
          left: chatOpen ? LEFT_WITH_CHAT_PX : PANEL_GAP_PX,
        }}
        className={cn(
          // 右側は駅詳細が使うので、現在地は左下に置く（同時に開いても重ならない）。
          'pointer-events-auto absolute bottom-16 z-20 flex max-h-[60vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-[transform,opacity,left] duration-300 ease-out',
          active ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
      >
        {active && <PanelBody onClose={stop} />}
      </aside>
    )
  }

  return (
    <Drawer.Root open={active} onOpenChange={(next) => !next && stop()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-white outline-none">
          <Drawer.Title className="sr-only">現在地の災害リスク</Drawer.Title>
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300" />
          <PanelBody onClose={stop} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
