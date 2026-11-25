'use client'

/** statTable Panel のレンダラ（ラベル付き値の一覧＝増減率 9 ペア等）。`folded` は「題（N）」の 1 行に畳む。 */

import { type StatTablePanel } from '@/shared/protocol'
import { showsFolded } from '@/shared/stat-table'
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

const ROW_CLASS = cn(
  'flex min-w-fit items-baseline justify-between gap-2 border-b border-slate-100 pb-1',
  ROW_BASIS,
)

/** 値の字（⚠ の行は琥珀色）。数値と単位のあいだで折り返させない（「231,483 ／ 百万円」の 2 行割れを防ぐ）。 */
const valueClass = (flagged: boolean): string =>
  cn(
    'shrink-0 text-sm font-medium whitespace-nowrap tabular-nums',
    flagged ? 'text-amber-600' : 'text-slate-800',
  )

/** 表の 1 行（ラベルと値・⚠）。ラベルは最後の手段として折り返す（パネルより長い行でも、はみ出させない）。 */
function StatRow({ row }: { row: StatTablePanel['rows'][number] }) {
  return (
    <div className={ROW_CLASS}>
      <dt className="min-w-0 text-xs break-words text-slate-500 tabular-nums">{row.label}</dt>
      <dd className={valueClass(row.flagged)}>
        {row.value}
        {row.flagged ? ' ⚠' : ''}
      </dd>
    </div>
  )
}

/** 表の中身（行と注記）。畳んだときも開いたときも同じ。 */
function StatRows({ panel }: { panel: StatTablePanel }) {
  return (
    <>
      {panel.rows.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {panel.rows.map((row) => (
            <StatRow key={row.label} row={row} />
          ))}
        </dl>
      )}
      {panel.note !== null && panel.note !== undefined && (
        <p className="mt-2 text-xs text-slate-400">{panel.note}</p>
      )}
    </>
  )
}

/** 畳んだ表（「題（行の数）」の 1 行。押すと同じ表が開く＝消さずに畳む・人口タブの人口増減率＝D-5）。 */
function FoldedStatTable({ panel, titleClass }: { panel: StatTablePanel; titleClass: string }) {
  return (
    <details>
      <summary className={cn(titleClass, 'cursor-pointer hover:text-slate-600')}>
        {panel.title}（{panel.rows.length}）
      </summary>
      <StatRows panel={panel} />
    </details>
  )
}

export function StatTable({ panel }: { panel: StatTablePanel }) {
  const compact = panel.size === 'compact'
  const titleClass = cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')
  // 行の無い表は畳まない（題だけ）。
  if (showsFolded(panel)) return <FoldedStatTable panel={panel} titleClass={titleClass} />
  return (
    <section>
      <h3 className={titleClass}>{panel.title}</h3>
      <StatRows panel={panel} />
    </section>
  )
}
