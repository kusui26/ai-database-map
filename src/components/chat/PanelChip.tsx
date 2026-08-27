'use client'

/**
 * スレッドに残す「図への参照」チップ（260802）。
 *
 * 図そのものはキャンバス（narrow ならモーダル）に出し、スレッドは**テキストだけ**にする。
 * 文言は**パネルのタイトルをそのまま使う**ので、絞り込み条件（都道府県・会社・路線）まで残り、
 * 開かなくてもどの回答か分かる（docs/260802_ai_chat_canvs.md §6）。
 */

import { type Panel } from '@/shared/protocol'
import { type GroupPromotion, type PanelGroup } from './panelGroups'
import { usePromote } from './usePromote'

/** チップに出す見出し。図はタイトルを、駅詳細は駅名を、地点のハザードは地点名を使う。 */
export function chipLabel(panels: readonly Panel[]): string {
  for (const panel of panels) {
    if (panel.type === 'stationCard') return `${panel.label} の詳細`
    if (panel.type === 'hazardCard') return `${panel.placeJa} の災害リスク`
    if (panel.type === 'evacuationList')
      return `${panel.placeJa} の${panel.siteKindJa}（${panel.forDisasterJa}）`
    if (panel.type === 'escapeDirection')
      return `${panel.placeJa} から出る向き（${panel.forDisasterJa}）`
    if (panel.type !== 'markdown') return panel.title
  }
  return '結果'
}

function IconFor({ kind }: { kind: GroupPromotion['kind'] }) {
  const path =
    kind === 'scatter'
      ? 'M4 20V4M4 20h16M9 15.5a1 1 0 1 0 0-.001M14 9.5a1 1 0 1 0 0-.001M18 13.5a1 1 0 1 0 0-.001'
      : kind === 'ranking'
        ? 'M4 20h4V10H4v10ZM10 20h4V4h-4v16ZM16 20h4v-7h-4v7Z'
        : 'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z'
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-indigo-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5 shrink-0 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PanelChip({ group, promotion }: { group: PanelGroup; promotion: GroupPromotion }) {
  const promote = usePromote()
  const label = chipLabel(group.panels)

  return (
    <button
      type="button"
      onClick={() => promote(promotion)}
      title={label}
      className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:ring-slate-300"
    >
      <IconFor kind={promotion.kind} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ExpandIcon />
    </button>
  )
}
