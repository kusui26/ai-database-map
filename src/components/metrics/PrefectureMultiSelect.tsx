'use client'

/** 都道府県の複数選択（ポップオーバー＋チェックボックス・P6c）。空＝全国。 */

import { useEffect, useRef, useState } from 'react'
import { PREFECTURES, prefectureLabel } from '@/shared/constants'
import { cn } from '@/lib/utils'

export function PrefectureMultiSelect({
  selected,
  onChange,
  className,
}: {
  selected: string[]
  onChange: (prefectures: string[]) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
    onChange(selected.includes(name) ? selected.filter((p) => p !== name) : [...selected, name])
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label="都道府県"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 transition-colors hover:border-slate-300"
      >
        <span className="max-w-[9rem] truncate">{prefectureLabel(selected)}</span>
        <svg viewBox="0 0 24 24" className="size-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            全国（すべて解除）
          </button>
          {PREFECTURES.map((p) => (
            <label
              key={p.code}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(p.name)}
                onChange={() => toggle(p.name)}
                className="size-4 accent-indigo-600"
              />
              {p.name}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
