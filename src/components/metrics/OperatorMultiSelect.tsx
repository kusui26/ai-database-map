'use client'

/**
 * 運営会社の複数選択（ポップオーバー＋検索＋チェックボックス・260730）。
 *
 * 都道府県（47 件）と違い会社は **181 件**あるため、検索と「駅数の多い順」が要る
 * （上位 10 社で延べの 56% を占めるので、多くの用途は検索なしで届く）。
 * 空＝全社。複数選択は OR（どれか 1 社でも運営していれば対象）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { operatorLabel } from '@/shared/constants'
import { cn } from '@/lib/utils'
import { useOperators } from './useOperators'

/** 一覧に表示する最大件数（検索で絞り込めるため上限を設けて描画量を抑える）。 */
const MAX_VISIBLE = 60

export function OperatorMultiSelect({
  selected,
  onChange,
  className,
}: {
  selected: string[]
  onChange: (operators: string[]) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const { operators, isLoading, error } = useOperators(open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current !== null && e.target instanceof Node && !ref.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((o) => o !== name) : [...selected, name])
  }

  // 選択済みは常に先頭（検索で消えて解除できなくなるのを防ぐ）。
  const visible = useMemo(() => {
    const keyword = query.trim()
    const matched = operators.filter(
      (operator) => keyword.length === 0 || operator.name.includes(keyword),
    )
    const chosen = matched.filter((operator) => selected.includes(operator.name))
    const rest = matched.filter((operator) => !selected.includes(operator.name))
    return [...chosen, ...rest].slice(0, MAX_VISIBLE)
  }, [operators, query, selected])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label="運営会社"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 transition-colors hover:border-slate-300"
      >
        <span className="max-w-[11rem] truncate">{operatorLabel(selected)}</span>
        <svg
          viewBox="0 0 24 24"
          className="size-3.5 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 flex max-h-80 w-72 flex-col rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="会社名で検索（例：東日本旅客鉄道）"
            aria-label="運営会社を検索"
            className="mb-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            全社（すべて解除）
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error !== undefined && (
              <p className="px-2 py-1 text-xs text-amber-600">会社一覧を取得できませんでした。</p>
            )}
            {isLoading && <p className="px-2 py-1 text-xs text-slate-400">読み込み中…</p>}
            {!isLoading && error === undefined && visible.length === 0 && (
              <p className="px-2 py-1 text-xs text-slate-400">該当する会社がありません。</p>
            )}
            {visible.map((operator) => (
              <label
                key={operator.name}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(operator.name)}
                  onChange={() => toggle(operator.name)}
                  className="size-4 shrink-0 accent-indigo-600"
                />
                <span className="min-w-0 flex-1 truncate">{operator.name}</span>
                <span className="shrink-0 text-xs text-slate-400 tabular-nums">
                  {operator.stationCount}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
