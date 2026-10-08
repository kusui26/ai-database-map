'use client'

/**
 * 路線（運行系統）の複数選択（ポップオーバー＋検索＋事業者ごとの一覧・2026-10-08 L4）。
 *
 * 選択肢は路線の表（`/api/lines`＝駅データ.jp）から作る。路線は利用者が呼ぶ路線（JR山手線＝環状の 30 駅）で、
 * 路線色の見本を付け、**事業者の通称**（「JR東日本」「東京メトロ」「東京都交通局」）でまとめる。
 * 正式名（「JR京都線」＝JR東海道本線(京都～大阪)）・事業者・都道府県はホバーで読め、検索が正式名で当たったときだけ
 * 正式名を小さく添える（「東海道本線」で「琵琶湖線」が出た理由が分かるように）。
 * 並べ方は `linePicker.ts`、都道府県・会社との連動は `lineLink.ts`。空＝全路線。複数選択は OR（どれかの路線の駅）。
 *
 * 法令上の路線（S12）はここには出さない（「詳しい条件」・`RouteMultiSelect`）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Line } from '@/shared/api'
import { MAX_LINES_PER_QUERY } from '@/shared/constants'
import { cn } from '@/lib/utils'
import { messageJaOf } from '@/lib/fetch-json'
import {
  type LineGroup,
  type LinePickerView,
  formalNameHint,
  lineButtonLabel,
  linePickerView,
  lineTooltip,
} from './linePicker'
import { placementStyle, usePopoverPlacement } from './usePopoverPlacement'

/** ポップオーバーの幅（長い路線名「JR室蘭本線(長万部・室蘭～苫小牧)」と駅数が 1 行に入る幅）。 */
const POPOVER_WIDTH_PX = 320

/** 路線色の見本（白に近い色でも見えるよう縁を付ける）。色の無い路線は灰色。 */
function LineSwatch({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="h-3.5 w-1.5 shrink-0 rounded-sm ring-1 ring-black/10 ring-inset"
      style={{ backgroundColor: color ?? '#CBD5E1' }}
    />
  )
}

function LineOption({
  line,
  checked,
  disabled,
  formalHint,
  onToggle,
}: {
  line: Line
  checked: boolean
  disabled: boolean
  /** 検索が正式名で当たったときの正式名（それ以外は null）。 */
  formalHint: string | null
  onToggle: (code: number) => void
}) {
  return (
    <label
      title={lineTooltip(line)}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1 text-sm',
        disabled
          ? 'cursor-not-allowed text-slate-300'
          : 'cursor-pointer text-slate-700 hover:bg-slate-50',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(line.lineCd)}
        className="size-4 shrink-0 accent-indigo-600 disabled:opacity-40"
      />
      <LineSwatch color={disabled ? null : line.color} />
      <span className="min-w-0 flex-1 truncate">
        {line.name}
        {formalHint !== null && (
          <span className={cn('ml-1 text-xs', disabled ? 'text-slate-300' : 'text-slate-400')}>
            {formalHint}
          </span>
        )}
      </span>
      <span
        className={cn(
          'shrink-0 text-xs tabular-nums',
          disabled ? 'text-slate-300' : 'text-slate-400',
        )}
      >
        {line.stationCount}
      </span>
    </label>
  )
}

/** 見出しつきの 1 かたまり（事業者・選択中）。見出しはスクロールしても上に残る。 */
function OptionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <p
        aria-hidden
        className="sticky top-0 z-10 bg-white/95 px-2 pt-1.5 pb-0.5 text-xs font-semibold text-slate-500 backdrop-blur-sm"
      >
        {title}
      </p>
      {children}
    </div>
  )
}

function CompanyGroup({
  group,
  query,
  isFull,
  onToggle,
}: {
  group: LineGroup<Line>
  query: string
  isFull: boolean
  onToggle: (code: number) => void
}) {
  return (
    <OptionGroup title={group.company}>
      {group.lines.map((line) => (
        <LineOption
          key={line.lineCd}
          line={line}
          checked={false}
          disabled={isFull || group.disabled.has(line.lineCd)}
          formalHint={formalNameHint(line, query)}
          onToggle={onToggle}
        />
      ))}
    </OptionGroup>
  )
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 外側を押したら閉じる（ほかの絞り込みのポップオーバーと同じ作法）。 */
function useCloseOnOutside(
  open: boolean,
  ref: React.RefObject<HTMLDivElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current !== null && e.target instanceof Node && !ref.current.contains(e.target)) {
        close()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, ref, close])
}

/** 一覧（選択中 → 事業者ごと → 出さなかった本数）。スクロールするのはここだけ。 */
function LineList({
  view,
  query,
  isLoading,
  error,
  isFull,
  onToggle,
}: {
  view: LinePickerView<Line>
  query: string
  isLoading: boolean
  error: Error | undefined
  isFull: boolean
  onToggle: (code: number) => void
}) {
  const isEmpty = view.selected.length === 0 && view.groups.length === 0
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {error !== undefined && (
        <p className="px-2 py-1 text-xs text-amber-600">
          {messageJaOf(error, '路線の一覧を取得できませんでした。')}
        </p>
      )}
      {isLoading && <p className="px-2 py-1 text-xs text-slate-400">読み込み中…</p>}
      {!isLoading && error === undefined && isEmpty && (
        <p className="px-2 py-1 text-xs text-slate-400">該当する路線がありません。</p>
      )}
      {view.selected.length > 0 && (
        <OptionGroup title="選択中">
          {view.selected.map((line) => (
            <LineOption
              key={line.lineCd}
              line={line}
              checked
              disabled={false}
              formalHint={formalNameHint(line, query)}
              onToggle={onToggle}
            />
          ))}
        </OptionGroup>
      )}
      {view.groups.map((group) => (
        <CompanyGroup
          key={group.company}
          group={group}
          query={query}
          isFull={isFull}
          onToggle={onToggle}
        />
      ))}
      {view.hiddenCount > 0 && (
        <p className="px-2 py-1.5 text-xs text-slate-400">
          ほか {view.hiddenCount} 本。路線名・会社名で検索するか、都道府県を選ぶと絞れます。
        </p>
      )}
    </div>
  )
}

/** 一覧の上の説明（連動で絞っている・上限に達した）。 */
function PickerHints({
  allowedCount,
  allowedScope,
  isFull,
}: {
  allowedCount: number | null
  allowedScope: string | undefined
  isFull: boolean
}) {
  return (
    <>
      {allowedCount !== null && (
        <p className="mb-1 px-2 text-xs text-slate-400">
          選択中の{allowedScope ?? '条件'}に合う {allowedCount} 本のみ選べます
        </p>
      )}
      {isFull && (
        <p className="mb-1 px-2 text-xs text-amber-600">
          路線は {MAX_LINES_PER_QUERY} 本まで選べます。ほかを選ぶには、どれかを外してください。
        </p>
      )}
    </>
  )
}

export function LineMultiSelect({
  selected,
  onChange,
  lines,
  isLoading,
  error,
  allowed,
  allowedScope,
  className,
}: {
  /** 選んだ路線コード（選んだ順）。 */
  selected: readonly number[]
  onChange: (lines: number[]) => void
  lines: readonly Line[]
  isLoading: boolean
  error: Error | undefined
  /** 選べる路線（未指定＝全路線）。含まれない路線は、検索したときだけ薄く出す。 */
  allowed?: readonly number[]
  /** 候補を絞っている条件の名前（例「都道府県・会社」）。説明文に出す。 */
  allowedScope?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  // 閉じたら検索語を消す。候補は都道府県・会社で変わるので、開き直したときに前の検索の結果
  // （選べない路線）を出さない。
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])
  useCloseOnOutside(open, ref, close)
  const placement = usePopoverPlacement(open, ref, POPOVER_WIDTH_PX)
  const allowedSet = useMemo(() => (allowed === undefined ? null : new Set(allowed)), [allowed])
  const view = useMemo(
    () => linePickerView({ lines, selected, query, allowed: allowedSet }),
    [lines, selected, query, allowedSet],
  )
  const isFull = selected.length >= MAX_LINES_PER_QUERY
  const toggle = (code: number) => {
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])
  }
  const firstColor = view.selected[0]?.color ?? null

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label="路線"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 transition-colors hover:border-slate-300"
      >
        {firstColor !== null && <LineSwatch color={firstColor} />}
        <span className="max-w-[11rem] truncate">{lineButtonLabel(selected, lines)}</span>
        <Chevron />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 z-50 mt-1 flex max-h-96 w-80 flex-col rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200"
          style={placementStyle(placement)}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="路線名・会社名で検索（例：山手線）"
            aria-label="路線を検索"
            className="mb-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            全路線（すべて解除）
          </button>
          <PickerHints
            allowedCount={allowedSet === null ? null : allowedSet.size}
            allowedScope={allowedScope}
            isFull={isFull}
          />
          <LineList
            view={view}
            query={query}
            isLoading={isLoading}
            error={error}
            isFull={isFull}
            onToggle={toggle}
          />
        </div>
      )}
    </div>
  )
}
