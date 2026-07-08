'use client'

/**
 * 駅詳細パネル（骨格＋乗降タブ）。デスクトップ＝右ドロワー／モバイル＝vaul ボトムシート。
 * ?grp 選択で開き、閉じると ?grp をクリア。カード＋タブは Protocol の Panel を PanelStack で描画する。
 * タブは 5 カテゴリの器を用意し、P5a では乗降のみ実装（人口・地価… は P5b/P5c）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { type Panel } from '@/shared/protocol'
import { type StationDetail } from '@/shared/api'
import { type Category, CATEGORY_LABELS_JA } from '@/shared/constants'
import { paxTrendPanel, stationCardPanel } from '@/domain/stations/panels'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useStationDetail } from '@/components/detail/useStationDetail'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { PanelRenderer, PanelStack } from '@/components/panels/PanelRenderer'
import { cn } from '@/lib/utils'

/** 詳細タブの器（表示順）。乗降のみ P5a で実装。 */
const DETAIL_TABS: readonly Category[] = [
  'passenger',
  'population',
  'land_price',
  'bus',
  'establishment',
]

/** タブごとの本文パネル（未実装カテゴリは空＝プレースホルダ表示）。 */
function tabPanels(detail: StationDetail, tab: Category): Panel[] {
  if (tab === 'passenger') return [paxTrendPanel(detail)]
  return []
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="閉じる"
      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function DetailTabs({ value, onChange }: { value: Category; onChange: (tab: Category) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2">
      {DETAIL_TABS.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onChange(category)}
          className={cn(
            'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === category
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {CATEGORY_LABELS_JA[category]}
        </button>
      ))}
    </div>
  )
}

function TabContent({ detail, tab }: { detail: StationDetail; tab: Category }) {
  const panels = tabPanels(detail, tab)
  if (panels.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400">
        「{CATEGORY_LABELS_JA[tab]}」タブは P5b / P5c で実装します。
      </div>
    )
  }
  return <PanelStack panels={panels} />
}

type BodyProps = {
  detail: StationDetail | undefined
  isLoading: boolean
  error: Error | undefined
  tab: Category
  onTab: (tab: Category) => void
  onClose: () => void
}

/** 詳細パネルの中身（ドロワー／シート共通）。ヘッダ＝駅カード、以下にタブと本文。 */
function DetailBody({ detail, isLoading, error, tab, onTab, onClose }: BodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          {detail !== undefined ? (
            <PanelRenderer panel={stationCardPanel(detail)} />
          ) : (
            <p className="py-2 text-sm text-slate-400">{isLoading ? '読み込み中…' : '駅を選択'}</p>
          )}
        </div>
        <CloseButton onClick={onClose} />
      </header>

      <DetailTabs value={tab} onChange={onTab} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error !== undefined ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
            詳細を取得できませんでした。時間をおいて再度お試しください。
          </div>
        ) : detail === undefined ? (
          <div className="grid h-40 place-items-center text-sm text-slate-400">読み込み中…</div>
        ) : (
          <TabContent detail={detail} tab={tab} />
        )}
      </div>
    </div>
  )
}

export function StationDetailPanel() {
  const { grp, setGrp } = useMapUrlState()
  const isDesktop = useIsDesktop()
  const { detail, isLoading, error } = useStationDetail(grp)
  const [tab, setTab] = useState<Category>('passenger')

  // 駅が変わったら乗降タブに戻す
  useEffect(() => {
    setTab('passenger')
  }, [grp])

  const open = grp !== null
  const close = useCallback(() => {
    void setGrp(null)
  }, [setGrp])

  const body = (
    <DetailBody
      detail={detail}
      isLoading={isLoading}
      error={error}
      tab={tab}
      onTab={setTab}
      onClose={close}
    />
  )

  if (isDesktop) {
    return (
      <aside
        aria-hidden={!open}
        className={cn(
          'pointer-events-auto absolute top-20 right-3 bottom-3 z-30 flex w-[min(380px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-[transform,opacity] duration-300 ease-out',
          open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[120%] opacity-0',
        )}
      >
        {open || detail !== undefined ? body : null}
      </aside>
    )
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-40 flex max-h-[86vh] flex-col rounded-t-2xl bg-white outline-none">
          <div className="mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />
          <Drawer.Title className="sr-only">{detail?.station.stationName ?? '駅詳細'}</Drawer.Title>
          {body}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
