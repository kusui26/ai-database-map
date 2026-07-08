'use client'

/** statTable Panel のレンダラ（ラベル付き値の一覧＝増減率 9 ペア等）。 */

import { type StatTablePanel } from '@/shared/protocol'
import { cn } from '@/lib/utils'

export function StatTable({ panel }: { panel: StatTablePanel }) {
  const compact = panel.size === 'compact'

  return (
    <section>
      <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
        {panel.title}
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {panel.rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-1"
          >
            <dt className="text-xs whitespace-nowrap text-slate-500 tabular-nums">{row.label}</dt>
            <dd
              className={cn(
                'text-sm font-medium tabular-nums',
                row.flagged ? 'text-amber-600' : 'text-slate-800',
              )}
            >
              {row.value}
              {row.flagged ? ' ⚠' : ''}
            </dd>
          </div>
        ))}
      </dl>
      {panel.note !== null && panel.note !== undefined && (
        <p className="mt-2 text-xs text-slate-400">{panel.note}</p>
      )}
    </section>
  )
}
