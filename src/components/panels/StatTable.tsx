'use client'

/** statTable Panel のレンダラ（ラベル付き値の一覧＝増減率 9 ペア等）。 */

import { type StatTablePanel } from '@/shared/protocol'
import { cn } from '@/lib/utils'

/**
 * 行の基準幅（パネル幅の半分から、列ギャップ `gap-x-4` の半分を引いた値）。
 *
 * 行は基準幅で 2 列に詰み、**中身が半分に収まらない行だけ**（`min-w-fit`）が 1 行を占める。
 * 固定 2 列だった頃は、収まらない行がセルからはみ出して隣の列の文字に重なっていた
 * （所得の「課税対象所得 総額（2025年度） 46,606,688 百万円」＝実測 265px > セル 186px。
 * docs/260816_stat_table_layout.md）。基準幅を「ちょうど半分」にしてあるので、
 * 収まる行は幅が揃い、値の右端が列で一直線になる。
 */
const ROW_BASIS = 'basis-[calc(50%-0.5rem)]'

export function StatTable({ panel }: { panel: StatTablePanel }) {
  const compact = panel.size === 'compact'

  return (
    <section>
      <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
        {panel.title}
      </h3>
      {panel.rows.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {panel.rows.map((row) => (
            <div
              key={row.label}
              className={cn(
                'flex min-w-fit items-baseline justify-between gap-2 border-b border-slate-100 pb-1',
                ROW_BASIS,
              )}
            >
              {/* ラベルは最後の手段として折り返す（パネルより長い行でも、はみ出させない）。 */}
              <dt className="min-w-0 text-xs break-words text-slate-500 tabular-nums">
                {row.label}
              </dt>
              {/* 値は数値と単位のあいだで折り返させない（「231,483 ／ 百万円」の 2 行割れを防ぐ）。 */}
              <dd
                className={cn(
                  'shrink-0 text-sm font-medium whitespace-nowrap tabular-nums',
                  row.flagged ? 'text-amber-600' : 'text-slate-800',
                )}
              >
                {row.value}
                {row.flagged ? ' ⚠' : ''}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {panel.note !== null && panel.note !== undefined && (
        <p className="mt-2 text-xs text-slate-400">{panel.note}</p>
      )}
    </section>
  )
}
