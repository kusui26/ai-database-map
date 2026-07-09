'use client'

/** rankingTable Panel のレンダラ（順位表・値 format 済・⚠ 列）。onSelect で行クリック→駅選択。 */

import { type RankingTablePanel } from '@/shared/protocol'
import { cn } from '@/lib/utils'

export function RankingTable({
  panel,
  onSelect,
}: {
  panel: RankingTablePanel
  onSelect?: (grp: string) => void
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-800">{panel.title}</h3>
        {panel.unit !== null && (
          <span className="shrink-0 text-xs text-slate-400">単位: {panel.unit}</span>
        )}
      </div>

      {panel.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">該当する駅がありません</p>
      ) : (
        <ol className="mt-2 divide-y divide-slate-100">
          {panel.rows.map((row) => (
            <li key={row.grp}>
              <button
                type="button"
                disabled={onSelect === undefined}
                onClick={() => onSelect?.(row.grp)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm',
                  onSelect !== undefined && 'cursor-pointer hover:bg-indigo-50',
                )}
              >
                <span className="w-6 shrink-0 text-right text-slate-400 tabular-nums">
                  {row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-slate-800">{row.name}</span>
                  <span className="ml-1.5 text-xs text-slate-400">{row.prefecture}</span>
                </span>
                <span
                  className={cn(
                    'shrink-0 font-medium tabular-nums',
                    row.flagged ? 'text-amber-600' : 'text-slate-800',
                  )}
                >
                  {row.formatted}
                  {row.flagged ? ' ⚠' : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
