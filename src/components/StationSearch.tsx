'use client'

import { useEffect, useState } from 'react'
import { type StationSummary } from '@/shared/api'
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useMapUrlState } from './map/useMapUrlState'

const DEBOUNCE_MS = 250

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className="size-4 shrink-0 text-slate-400">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m14 14 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** 駅名検索（cmdk・debounce 250ms・サーバ検索）。選択で ?grp を更新 → 地図が flyTo。 */
export function StationSearch() {
  const { setGrp } = useMapUrlState()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StationSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q === '') {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/stations?q=${encodeURIComponent(q)}`, {
            signal: controller.signal,
          })
          const data: StationSummary[] = res.ok ? await res.json() : []
          if (!cancelled) {
            setResults(data)
            setLoading(false)
          }
        } catch {
          if (!cancelled) setLoading(false)
        }
      })()
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const select = (station: StationSummary): void => {
    void setGrp(station.grp)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const showList = open && query.trim() !== ''

  return (
    <div className="relative w-full">
      <Command shouldFilter={false} className="overflow-visible" label="駅名で検索">
        <div className="flex items-center gap-2 rounded-xl bg-white/90 px-3 shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <SearchIcon />
          <CommandInput
            value={query}
            onValueChange={setQuery}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="駅名で検索…"
          />
        </div>
        {showList && (
          <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-200 backdrop-blur">
            <CommandList>
              {loading && <div className="py-6 text-center text-sm text-slate-400">検索中…</div>}
              {!loading && results.length === 0 && (
                <div className="py-6 text-center text-sm text-slate-400">
                  該当する駅がありません
                </div>
              )}
              {results.map((station) => (
                <CommandItem key={station.grp} value={station.grp} onSelect={() => select(station)}>
                  <span className="truncate font-medium">{station.stationName}</span>
                  <span className="shrink-0 text-xs text-slate-400">{station.prefecture}</span>
                </CommandItem>
              ))}
            </CommandList>
          </div>
        )}
      </Command>
    </div>
  )
}
