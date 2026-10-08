'use client'

/**
 * 運営会社の複数選択（ポップオーバー＋検索＋チェックボックス・260730）。
 *
 * 都道府県（47 件）と違い会社は **181 件**あるため、検索と「駅数の多い順」が要る
 * （上位 10 社で延べの 56% を占めるので、多くの用途は検索なしで届く）。
 * 空＝全社。複数選択は OR（どれか 1 社でも運営していれば対象）。
 *
 * 260731：都道府県・路線との連動。`allowed` を渡すと、その条件に合わない会社は**グレーアウト**し
 * （0 件になる組合せを防ぐ）、選択中の会社の都道府県をまとめて選ぶボタンを出す。
 * 何で絞られているかは条件によって変わるため、説明文の主語は `allowedScope` で受け取る。
 *
 * 2026-10-08 L4：会社は**表示名**（駅データ.jp の事業者名「JR東日本」「東京メトロ」「東京都交通局」）で出す。
 * 条件の鍵は S12 の会社名（「東日本旅客鉄道」）のままで、検索はどちらでも当たり、ホバーで S12 の名前も読める。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { type Operator } from '@/shared/api'
import { operatorLabel } from '@/shared/constants'
import { cn } from '@/lib/utils'
import { messageJaOf } from '@/lib/fetch-json'
import { matchesTokens, searchTokens } from './search'
import { placementStyle, usePopoverPlacement } from './usePopoverPlacement'

/** 一覧に表示する最大件数（検索で絞り込めるため上限を設けて描画量を抑える）。 */
const MAX_VISIBLE = 60

/** ポップオーバーの幅（`w-72`）。画面からはみ出すときは左へずらす。 */
const POPOVER_WIDTH_PX = 288

/** 会社の表示名（一覧に表示名が無い・読み込み前は S12 の名前のまま）。 */
function displayNameOf(operator: Operator): string {
  return operator.label ?? operator.name
}

/** ボタンに出す言い方（選んだ会社の表示名・空＝全社）。 */
function buttonLabel(selected: readonly string[], operators: readonly Operator[]): string {
  const byName = new Map(operators.map((operator) => [operator.name, displayNameOf(operator)]))
  return operatorLabel(selected.map((name) => byName.get(name) ?? name))
}

/** ホバー：表示名と S12 の会社名が違えば両方（「東京メトロ（東京地下鉄）」）。 */
function operatorTitle(operator: Operator): string {
  const label = displayNameOf(operator)
  return label === operator.name ? label : `${label}（${operator.name}）`
}

export function OperatorMultiSelect({
  selected,
  onChange,
  operators,
  isLoading,
  error,
  allowed,
  allowedScope,
  onApplyPrefectures,
  applyPrefectureCount,
  className,
}: {
  selected: string[]
  onChange: (operators: string[]) => void
  operators: readonly Operator[]
  isLoading: boolean
  error: Error | undefined
  /** 選べる会社（未指定＝全社）。含まれない会社はグレーアウト。 */
  allowed?: readonly string[]
  /** 候補を絞っている条件の名前（例「都道府県・路線」）。説明文に出す。 */
  allowedScope?: string
  /** 「選択中の会社の都道府県を選ぶ」ボタン（未指定なら出さない）。 */
  onApplyPrefectures?: () => void
  /** 上記ボタンに表示する県数（0 なら出さない）。 */
  applyPrefectureCount?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const allowedSet = useMemo(() => (allowed === undefined ? null : new Set(allowed)), [allowed])
  const placement = usePopoverPlacement(open, ref, POPOVER_WIDTH_PX)

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

  // 並びは「選択済み → 選べる → グレーアウト」。検索で消えて解除できなくなるのを防ぐ。
  const visible = useMemo(() => {
    const tokens = searchTokens(query)
    const matched = operators.filter((operator) =>
      matchesTokens([operator.name, operator.label ?? null], tokens),
    )
    const rank = (operator: Operator): number => {
      if (selected.includes(operator.name)) return 0
      if (allowedSet === null || allowedSet.has(operator.name)) return 1
      return 2
    }
    return [...matched].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_VISIBLE)
  }, [operators, query, selected, allowedSet])

  const showApply =
    onApplyPrefectures !== undefined &&
    applyPrefectureCount !== undefined &&
    applyPrefectureCount > 0

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label="運営会社"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 transition-colors hover:border-slate-300"
      >
        <span className="max-w-[11rem] truncate">{buttonLabel(selected, operators)}</span>
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
        <div
          className="absolute top-full left-0 z-50 mt-1 flex max-h-80 w-72 flex-col rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200"
          style={placementStyle(placement)}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="会社名で検索（例：JR東日本）"
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
          {showApply && (
            <button
              type="button"
              onClick={onApplyPrefectures}
              className="mb-1 w-full rounded-md bg-indigo-50 px-2 py-1 text-left text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              この会社の都道府県を選択（{applyPrefectureCount}県）
            </button>
          )}
          {allowedSet !== null && (
            <p className="mb-1 px-2 text-xs text-slate-400">
              選択中の{allowedScope ?? '条件'}に合う {allowedSet.size} 社のみ選べます
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error !== undefined && (
              <p className="px-2 py-1 text-xs text-amber-600">
                {messageJaOf(error, '会社一覧を取得できませんでした。')}
              </p>
            )}
            {isLoading && <p className="px-2 py-1 text-xs text-slate-400">読み込み中…</p>}
            {!isLoading && error === undefined && visible.length === 0 && (
              <p className="px-2 py-1 text-xs text-slate-400">該当する会社がありません。</p>
            )}
            {visible.map((operator) => {
              const checked = selected.includes(operator.name)
              const disabled = allowedSet !== null && !allowedSet.has(operator.name) && !checked
              return (
                <label
                  key={operator.name}
                  title={operatorTitle(operator)}
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
                    onChange={() => toggle(operator.name)}
                    className="size-4 shrink-0 accent-indigo-600 disabled:opacity-40"
                  />
                  <span className="min-w-0 flex-1 truncate">{displayNameOf(operator)}</span>
                  <span
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      disabled ? 'text-slate-300' : 'text-slate-400',
                    )}
                  >
                    {operator.stationCount}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
