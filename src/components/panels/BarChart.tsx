'use client'

/**
 * barChart Panel のレンダラ（横棒・CSS 描画）。半径別・年次対比・内訳などに使う。
 *
 * 値に負があれば **0 を真ん中**に置き、負は左・正は右へ伸ばす（区ごとの人口の増減など・2026-10-10 B5b）。
 * 負が無ければ以前のまま左から伸ばす（半径別の地価・所得・売上——見た目は変えない）。
 * 名前が長い棒（区・市区町村・駅の名前）は、名前の列を広げる（短い名前〔500m・1km〕の列幅は以前のまま）。
 *
 * 負のある棒・名前の長い棒は、**リスト全体を 1 つのグリッド**にして列をそろえる（行は `contents`）。行ごとのグリッドだと
 * 値の文字（「+3.1%」「-11.5%」）の幅で棒の欄の幅が行ごとに変わり、0 の線が行ごとにずれた（実ブラウザで 1〜数 px）。
 */

import { type Bar, type BarChartPanel } from '@/shared/protocol'
import { ACCENT_COLOR, CATEGORY_COLORS } from '@/shared/constants'
import { cn } from '@/lib/utils'

/** 以前の名前の列（3.25rem）に収まる文字の数（「500m」「20km」「2024」）。 */
const SHORT_LABEL_CHARS = 4

/** 棒の塗り（負が無ければ左から、負があれば 0 を真ん中に）。 */
function BarFill({
  bar,
  scale,
  signed,
  color,
}: {
  bar: Bar
  scale: number
  signed: boolean
  color: string
}) {
  const backgroundColor = bar.emphasis === true ? ACCENT_COLOR : color
  if (!signed) {
    const pct = bar.value === null ? 0 : Math.round((Math.abs(bar.value) / scale) * 100)
    return (
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor }} />
    )
  }
  const half = bar.value === null ? 0 : (Math.abs(bar.value) / scale) * 50
  const left = bar.value !== null && bar.value < 0 ? 50 - half : 50
  return (
    <>
      <span aria-hidden className="absolute inset-y-[-2px] left-1/2 w-px bg-slate-300" />
      <span
        className="absolute inset-y-0 rounded-full"
        style={{ left: `${left}%`, width: `${half}%`, backgroundColor }}
      />
    </>
  )
}

export function BarChart({ panel }: { panel: BarChartPanel }) {
  const compact = panel.size === 'compact'
  const max = Math.max(1, ...panel.bars.map((bar) => Math.abs(bar.value ?? 0)))
  const signed = panel.bars.some((bar) => (bar.value ?? 0) < 0)
  const wideLabels = panel.bars.some((bar) => bar.label.length > SHORT_LABEL_CHARS)
  const aligned = signed || wideLabels
  const baseColor = panel.category === undefined ? ACCENT_COLOR : CATEGORY_COLORS[panel.category]

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
          {panel.title}
        </h3>
        {/* 単位はそれ自体が 1 語なので折り返さない（「万円/」「人」の 2 行割れを防ぐ）。 */}
        {panel.unit !== null && (
          <span className="shrink-0 text-xs whitespace-nowrap text-slate-400">
            単位: {panel.unit}
          </span>
        )}
      </div>

      <ul
        className={cn(
          'mt-2.5',
          aligned ? 'grid grid-cols-[7rem_1fr_auto] items-center gap-x-2 gap-y-1.5' : 'space-y-1.5',
        )}
      >
        {panel.bars.map((bar) => (
          <li
            key={bar.label}
            className={
              aligned ? 'contents' : 'grid grid-cols-[3.25rem_1fr_auto] items-center gap-2'
            }
          >
            <span className="truncate text-xs tabular-nums text-slate-500" title={bar.label}>
              {bar.label}
            </span>
            <span className={cn('h-2.5 rounded-full bg-slate-100', signed && 'relative')}>
              <BarFill bar={bar} scale={max} signed={signed} color={baseColor} />
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
        ))}
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
