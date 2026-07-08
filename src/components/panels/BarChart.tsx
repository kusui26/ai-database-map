'use client'

/** barChart Panel のレンダラ（横棒・CSS 描画）。半径別・年次対比・内訳などに使う。 */

import { type BarChartPanel } from '@/shared/protocol'
import { ACCENT_COLOR, CATEGORY_COLORS } from '@/shared/constants'
import { cn } from '@/lib/utils'

export function BarChart({ panel }: { panel: BarChartPanel }) {
  const compact = panel.size === 'compact'
  const max = Math.max(1, ...panel.bars.map((bar) => Math.abs(bar.value ?? 0)))
  const baseColor = panel.category === undefined ? ACCENT_COLOR : CATEGORY_COLORS[panel.category]

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
          {panel.title}
        </h3>
        {panel.unit !== null && <span className="text-xs text-slate-400">単位: {panel.unit}</span>}
      </div>

      <ul className="mt-2.5 space-y-1.5">
        {panel.bars.map((bar) => {
          const pct = bar.value === null ? 0 : Math.round((Math.abs(bar.value) / max) * 100)
          return (
            <li key={bar.label} className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-2">
              <span className="truncate text-xs tabular-nums text-slate-500">{bar.label}</span>
              <span className="h-2.5 rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: bar.emphasis === true ? ACCENT_COLOR : baseColor,
                  }}
                />
              </span>
              <span
                className={cn(
                  'text-right text-xs font-medium tabular-nums',
                  bar.flagged ? 'text-amber-600' : 'text-slate-700',
                )}
              >
                {bar.formatted}
                {bar.flagged ? ' ⚠' : ''}
              </span>
            </li>
          )
        })}
      </ul>

      {panel.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {panel.flags.map((flag) => (
            <li
              key={flag.label}
              className={cn('text-xs', flag.level === 'warn' ? 'text-amber-600' : 'text-slate-400')}
            >
              {flag.level === 'warn' ? '⚠ ' : ''}
              {flag.label}
            </li>
          ))}
        </ul>
      )}
      {panel.note !== null && panel.note !== undefined && (
        <p className="mt-2 text-xs text-slate-400">{panel.note}</p>
      )}
    </section>
  )
}
