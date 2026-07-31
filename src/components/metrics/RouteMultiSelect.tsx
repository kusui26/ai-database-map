'use client'

/**
 * 路線の複数選択（ポップオーバー＋種別チップ＋検索＋チェックボックス・260731）。
 *
 * 561 本あるため検索と「駅数の多い順」が要る。上段の**種別チップ**（新幹線／JR在来線／…）は
 * 独立したフィルタ（`routeTypes`）で、「新幹線駅だけ」が 1 クリックで済む（§9 決定 2）。
 * 種別と路線は **OR**（§9 決定 3）＝どちらかに当たる駅が対象。
 *
 * 同名の路線が複数社にあるため（「本線」は 10 社）、**重複時だけ会社名を併記**する（§9 決定 5）。
 * `allowed` を渡すと、選択中の会社が運営しない路線は**グレーアウト**する。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { type Route } from '@/shared/api'
import { ROUTE_TYPES, routeFilterLabel, routeOptionLabel, routeTypeLabel } from '@/shared/constants'
import { cn } from '@/lib/utils'

/** 一覧に表示する最大件数（検索で絞り込めるため上限を設けて描画量を抑える）。 */
const MAX_VISIBLE = 60

export function RouteMultiSelect({
  selected,
  selectedTypes,
  onChange,
  onChangeTypes,
  routes,
  isLoading,
  error,
  allowed,
  className,
}: {
  selected: string[]
  selectedTypes: number[]
  onChange: (routes: string[]) => void
  onChangeTypes: (routeTypes: number[]) => void
  routes: readonly Route[]
  isLoading: boolean
  error: Error | undefined
  /** 選べる路線（未指定＝全路線）。含まれない路線はグレーアウト。 */
  allowed?: readonly string[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const allowedSet = useMemo(() => (allowed === undefined ? null : new Set(allowed)), [allowed])

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
    onChange(selected.includes(name) ? selected.filter((r) => r !== name) : [...selected, name])
  }
  const toggleType = (type: number) => {
    onChangeTypes(
      selectedTypes.includes(type)
        ? selectedTypes.filter((t) => t !== type)
        : [...selectedTypes, type],
    )
  }

  // 並びは「選択済み → 選べる → グレーアウト」。検索で消えて解除できなくなるのを防ぐ。
  const visible = useMemo(() => {
    const keyword = query.trim()
    const matched = routes.filter(
      (route) =>
        keyword.length === 0 ||
        route.route.includes(keyword) ||
        route.operators.some((operator) => operator.includes(keyword)),
    )
    const rank = (route: Route): number => {
      if (selected.includes(route.route)) return 0
      if (allowedSet === null || allowedSet.has(route.route)) return 1
      return 2
    }
    return [...matched].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_VISIBLE)
  }, [routes, query, selected, allowedSet])

  // 種別と路線を両方選んだときだけ OR の注記を出す（片方だけなら自明）。
  const showOrHint = selectedTypes.length > 0 && selected.length > 0

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label="路線"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 transition-colors hover:border-slate-300"
      >
        <span className="max-w-[11rem] truncate">{routeFilterLabel(selected, selectedTypes)}</span>
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
          <div className="mb-1.5 flex flex-wrap gap-1" role="group" aria-label="事業者種別">
            {ROUTE_TYPES.map((type) => {
              const active = selectedTypes.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleType(type)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {routeTypeLabel(type)}
                </button>
              )
            })}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="路線名・会社名で検索（例：東海道新幹線）"
            aria-label="路線を検索"
            className="mb-1 w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              onChange([])
              onChangeTypes([])
            }}
            className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            全路線（すべて解除）
          </button>
          {showOrHint && (
            <p className="mb-1 px-2 text-xs text-slate-400">
              種別と路線は「どちらか」に当たる駅が対象です。
            </p>
          )}
          {allowedSet !== null && (
            <p className="mb-1 px-2 text-xs text-slate-400">
              選択中の会社が運営する {allowedSet.size} 本のみ選べます
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error !== undefined && (
              <p className="px-2 py-1 text-xs text-amber-600">路線一覧を取得できませんでした。</p>
            )}
            {isLoading && <p className="px-2 py-1 text-xs text-slate-400">読み込み中…</p>}
            {!isLoading && error === undefined && visible.length === 0 && (
              <p className="px-2 py-1 text-xs text-slate-400">該当する路線がありません。</p>
            )}
            {visible.map((route) => {
              const checked = selected.includes(route.route)
              const disabled = allowedSet !== null && !allowedSet.has(route.route) && !checked
              const label = routeOptionLabel(route.route, route.operators)
              // 一覧は会社数に畳むため、会社名の全文はホバーで読めるようにする。
              const fullName =
                route.operators.length > 1
                  ? `${route.route}（${route.operators.join('・')}）`
                  : route.route
              return (
                <label
                  key={route.route}
                  title={fullName}
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
                    onChange={() => toggle(route.route)}
                    className="size-4 shrink-0 accent-indigo-600 disabled:opacity-40"
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      disabled ? 'text-slate-300' : 'text-slate-400',
                    )}
                  >
                    {route.stationCount}
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
