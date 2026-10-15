'use client'

/**
 * エリアの選び方：路線の沿線（2026-10-15 B5e・§6.12.10）。
 *
 * 路線は L4 の選び方と同じ並べ方（`linePickerView`：事業者の通称でまとめ、路線名・会社名で検索・路線色の見本）で、
 * ここでは 1 本だけ選ぶ。沿線＝路線の駅から幅（500m・1km・2km・既定 1km）の円を重ねた範囲（§12-22）。
 */

import { useMemo, useState } from 'react'
import { type Line } from '@/shared/api'
import {
  DEFAULT_LINE_WIDTH_M,
  formatAreaRef,
  LINE_WIDTHS_M,
  parseAreaRef,
  type LineWidthM,
} from '@/shared/area-ref'
import { radiusLabel } from '@/shared/constants'
import { messageJaOf } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'
import { LineSwatch } from '@/components/metrics/LineMultiSelect'
import { formalNameHint, linePickerView, lineTooltip } from '@/components/metrics/linePicker'
import { useLines } from '@/components/metrics/useLines'
import { SubmitButton } from './SubmitButton'

/** 替える沿線（路線コードと幅）。沿線でなければ null。 */
function lineOf(
  ref: string | null,
): { readonly lineCd: number; readonly widthM: LineWidthM } | null {
  const parsed = ref === null ? null : parseAreaRef(ref)
  if (parsed === null || !parsed.ok || parsed.ref.type !== 'line') return null
  return { lineCd: parsed.ref.lineCd, widthM: parsed.ref.widthM ?? DEFAULT_LINE_WIDTH_M }
}

function LineRow({
  line,
  checked,
  query,
  onChoose,
}: {
  line: Line
  checked: boolean
  query: string
  onChoose: (lineCd: number) => void
}) {
  const hint = formalNameHint(line, query)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      title={lineTooltip(line)}
      onClick={() => onChoose(line.lineCd)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
        checked ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-50',
      )}
    >
      <LineSwatch color={line.color} />
      <span className="min-w-0 flex-1 truncate">
        {line.name}
        {hint !== null && <span className="ml-1 text-xs text-slate-400">{hint}</span>}
      </span>
      <span className="shrink-0 text-xs text-slate-400 tabular-nums">{line.stationCount}</span>
    </button>
  )
}

function LineList({
  lines,
  query,
  lineCd,
  onChoose,
}: {
  lines: readonly Line[]
  query: string
  lineCd: number | null
  onChoose: (lineCd: number) => void
}) {
  const view = useMemo(
    () =>
      linePickerView({ lines, selected: lineCd === null ? [] : [lineCd], query, allowed: null }),
    [lines, lineCd, query],
  )
  const rows = [
    ...view.selected.map((line) => ({ company: '選択中', line })),
    ...view.groups.flatMap((group) =>
      group.lines.map((line) => ({ company: group.company, line })),
    ),
  ]
  return (
    <div
      role="radiogroup"
      aria-label="路線"
      className="max-h-56 overflow-y-auto rounded-lg p-1 ring-1 ring-slate-200"
    >
      {rows.length === 0 && (
        <p className="px-2 py-1 text-xs text-slate-400">該当する路線がありません。</p>
      )}
      {rows.map(({ company, line }, index) => (
        <div key={`${company}:${line.lineCd}`}>
          {rows[index - 1]?.company !== company && (
            <p aria-hidden className="px-2 pt-1.5 pb-0.5 text-xs font-semibold text-slate-500">
              {company}
            </p>
          )}
          <LineRow line={line} checked={line.lineCd === lineCd} query={query} onChoose={onChoose} />
        </div>
      ))}
      {view.hiddenCount > 0 && (
        <p className="px-2 py-1.5 text-xs text-slate-400">
          ほか {view.hiddenCount} 本。路線名・会社名で検索すると絞れます。
        </p>
      )}
    </div>
  )
}

function WidthSegment({
  value,
  onChange,
}: {
  value: LineWidthM
  onChange: (widthM: LineWidthM) => void
}) {
  return (
    <div
      role="group"
      aria-label="沿線の幅"
      className="flex shrink-0 gap-0.5 rounded-lg bg-slate-100 p-0.5"
    >
      {LINE_WIDTHS_M.map((width) => (
        <button
          key={width}
          type="button"
          aria-pressed={width === value}
          aria-label={`駅から ${radiusLabel(width)}`}
          onClick={() => onChange(width)}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
            width === value
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {radiusLabel(width)}
        </button>
      ))}
    </div>
  )
}

export function LineAreaTab({
  currentRef,
  submitJa,
  onPick,
}: {
  /** 替えるエリア（沿線なら、その路線と幅を選んだ状態で開く）。 */
  currentRef: string | null
  submitJa: string
  onPick: (ref: string) => void
}) {
  const current = lineOf(currentRef)
  const { lines, isLoading, error } = useLines(true)
  const [query, setQuery] = useState('')
  const [lineCd, setLineCd] = useState<number | null>(current?.lineCd ?? null)
  const [widthM, setWidthM] = useState<LineWidthM>(current?.widthM ?? DEFAULT_LINE_WIDTH_M)
  const submit = (): void => {
    if (lineCd !== null) onPick(formatAreaRef({ type: 'line', lineCd, widthM }))
  }
  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="路線名・会社名で検索（例：東横線）"
        aria-label="路線を検索"
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
      />
      {error !== undefined && (
        <p className="text-xs text-amber-700">
          {messageJaOf(error, '路線の一覧を取得できませんでした。')}
        </p>
      )}
      {isLoading ? (
        <p className="text-xs text-slate-400">路線の一覧を読み込み中…</p>
      ) : (
        <LineList lines={lines} query={query} lineCd={lineCd} onChoose={setLineCd} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">駅からの幅</span>
          <WidthSegment value={widthM} onChange={setWidthM} />
        </div>
        <SubmitButton disabled={lineCd === null} onClick={submit}>
          {submitJa}
        </SubmitButton>
      </div>
    </>
  )
}
