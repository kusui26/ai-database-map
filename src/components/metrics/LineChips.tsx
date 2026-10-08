'use client'

/**
 * 絞り込み中の路線（運行系統）を、外せるチップで出す（2026-10-08 L3）。
 *
 * チャットの図を ⤢ で開くと、AI が使った路線の条件（`lines`）が付いてくる。路線を選ぶ部品はまだ無い（L4）ので、
 * 条件が**見えないまま効き続けない**ように、名前と ✕ だけを出す（都道府県を変えたら 0 件、の理由が分かるように）。
 * 名前は図の応答（`lines`＝名前つき）から引き、届く前はコードを出さずに「路線」とだけ書く。
 */

import { type LineRef } from '@/shared/api'

function nameOf(code: number, known: readonly LineRef[]): string {
  return known.find((line) => line.lineCd === code)?.name ?? '路線'
}

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

/** 1 本の路線のチップ（名前と、絞り込みを外すボタン）。 */
function LineChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 py-1 pr-1 pl-2.5 text-sm text-indigo-800">
      <span className="max-w-[11rem] truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${name}の絞り込みを外す`}
        title="この路線の絞り込みを外す"
        className="rounded-md p-0.5 text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
      >
        <RemoveIcon />
      </button>
    </span>
  )
}

export function LineChips({
  selected,
  known,
  onChange,
}: {
  /** 絞り込み中の路線コード。 */
  selected: readonly number[]
  /** 名前の引き当て（図の応答の `lines`）。 */
  known: readonly LineRef[]
  onChange: (lines: number[]) => void
}) {
  if (selected.length === 0) return null
  const remove = (code: number) => onChange(selected.filter((other) => other !== code))
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="路線で絞り込み中">
      {selected.map((code) => (
        <LineChip key={code} name={nameOf(code, known)} onRemove={() => remove(code)} />
      ))}
    </div>
  )
}
