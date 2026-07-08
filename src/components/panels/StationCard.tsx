'use client'

/** 駅カード Panel のレンダラ（Protocol の stationCard をそのまま描画）。 */

import { type StationCardPanel } from '@/shared/protocol'
import { formatPaxLatest } from '@/domain/stations/panels'
import { cn } from '@/lib/utils'

export function StationCard({ panel }: { panel: StationCardPanel }) {
  const compact = panel.size === 'compact'
  const subtitle = [panel.prefecture, panel.operators].filter(Boolean).join(' ・ ')

  return (
    <div className={cn('rounded-xl bg-white', compact ? 'p-3' : 'px-1 py-1')}>
      <div className="flex items-baseline gap-2">
        <h2 className={cn('font-bold text-slate-900', compact ? 'text-lg' : 'text-2xl')}>
          {panel.stationName}
        </h2>
        <span className="text-xs text-slate-400">駅</span>
      </div>
      {subtitle.length > 0 && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-xs text-slate-400">最新乗降客数</span>
        <span
          className={cn(
            'font-semibold tabular-nums text-slate-900',
            compact ? 'text-base' : 'text-xl',
          )}
        >
          {formatPaxLatest(panel.paxLatest)}
        </span>
      </div>

      {panel.badges.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {panel.badges.map((badge) => (
            <li
              key={badge.label}
              className={cn(
                'rounded-md px-2 py-0.5 text-xs',
                badge.level === 'warn'
                  ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                  : 'bg-slate-100 text-slate-600',
              )}
            >
              {badge.level === 'warn' ? '⚠ ' : ''}
              {badge.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
