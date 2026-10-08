'use client'

/**
 * 画面の部品では選べない場所の条件を、外せるチップで出す（2026-10-08 B2）。
 *
 * 起点から N km（「竹橋から 5km」）と地図の範囲は、チャットの図を ⤢ で開いたときにだけ付いてくる。
 * 条件が**見えないまま効き続けない**ように、言い方と ✕ を出す（L3 の路線のチップと同じ考え方）。
 * 市区町村は、都道府県を 1 つ選んでいないとき（選択の部品が出ないとき）だけチップで出す。
 * 起点の言い方は図の応答から引き、届く前は「起点から 5km」とだけ書く。
 */

import { distanceLabel, MAP_AREA_LABEL_JA, nearLabel } from '@/shared/constants'

function RemoveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

function AreaChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 py-1 pr-1 pl-2.5 text-sm text-indigo-800">
      <span className="max-w-[14rem] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${label}の絞り込みを外す`}
        title="この絞り込みを外す"
        className="rounded-md p-0.5 text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
      >
        <RemoveIcon />
      </button>
    </span>
  )
}

export function AreaChips({
  near,
  originLabel,
  hasBbox,
  municipality,
  onClearNear,
  onClearBbox,
  onClearMunicipality,
}: {
  /** 起点の駅と半径（無ければ出さない）。 */
  near: { readonly radiusM: number } | null
  /** 起点の駅の表示名（図の応答の `near.label`・届く前は null）。 */
  originLabel: string | null
  hasBbox: boolean
  /** チップで出す市区町村（選択の部品で出しているときは null）。 */
  municipality: string | null
  onClearNear: () => void
  onClearBbox: () => void
  onClearMunicipality: () => void
}) {
  if (near === null && !hasBbox && municipality === null) return null
  const nearText =
    near === null
      ? null
      : originLabel === null
        ? `起点から ${distanceLabel(near.radiusM)}`
        : nearLabel(originLabel, near.radiusM)
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="場所で絞り込み中">
      {municipality !== null && <AreaChip label={municipality} onRemove={onClearMunicipality} />}
      {nearText !== null && <AreaChip label={nearText} onRemove={onClearNear} />}
      {hasBbox && <AreaChip label={MAP_AREA_LABEL_JA} onRemove={onClearBbox} />}
    </div>
  )
}
