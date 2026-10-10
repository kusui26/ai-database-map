'use client'

/**
 * スレッドに残す「図への参照」チップ（260802）。
 *
 * 図そのものはキャンバス・右の駅詳細に出し、スレッドは**テキストだけ**にする。
 * 文言は**パネルのタイトルをそのまま使う**ので、絞り込み条件（都道府県・会社・路線）まで残り、
 * 開かなくてもどの回答か分かる（docs/260802_ai_chat_canvs.md §6）。
 *
 * チップにするのは、図をチャットの外に出せる幅だけ。狭い画面・携帯では会話の中に図を出す
 * （`InlineFigure`・出し分けは `presentation.ts`・2026-10-02）。
 */

import { CATEGORY_LABELS_JA, DETAIL_TAB_LABELS_JA } from '@/shared/constants'
import { type PanelPromotion } from '@/shared/promotion'
import { type Panel } from '@/shared/protocol'
import { type PanelGroup } from './panelGroups'
import { usePromote } from './usePromote'

/** 駅詳細のチップで、何を開くか（概要・聞いたカテゴリ。焦点が無ければ「詳細」）。押す前に開く先が分かる。 */
function detailFocusLabel(promotion: PanelPromotion | null): string {
  if (promotion?.kind !== 'detail') return '詳細'
  if (promotion.tab !== undefined) return DETAIL_TAB_LABELS_JA[promotion.tab]
  return promotion.category === null ? '詳細' : CATEGORY_LABELS_JA[promotion.category]
}

/** チップに出す見出し。図はタイトルを、駅詳細は駅名と聞いたカテゴリを、地点のハザードは地点名を使う。 */
export function chipLabel(
  panels: readonly Panel[],
  promotion: PanelPromotion | null = null,
): string {
  for (const panel of panels) {
    if (panel.type === 'stationCard') return `${panel.label} の${detailFocusLabel(promotion)}`
    if (panel.type === 'hazardCard') return `${panel.placeJa} の災害リスク`
    if (panel.type === 'evacuationList')
      return `${panel.placeJa} の${panel.siteKindJa}（${panel.forDisasterJa}）`
    if (panel.type === 'escapeDirection')
      return `${panel.placeJa} から出る向き（${panel.forDisasterJa}）`
    if (panel.type !== 'markdown') return panel.title
  }
  return '結果'
}

function IconFor({ kind }: { kind: PanelPromotion['kind'] }) {
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

/** ⤢（広げる）。チップと、会話の中の図の「拡大」で使う。 */
export function ExpandIcon() {
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

export function PanelChip({ group, promotion }: { group: PanelGroup; promotion: PanelPromotion }) {
  const promote = usePromote()
  const label = chipLabel(group.panels, promotion)

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
