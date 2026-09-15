'use client'

/**
 * おすすめの結果表（順位・危険度・合成スコア・**内訳の帯**）。
 *
 * 帯があるのは、順位だけでは「なぜその駅なのか」が分からないため。1 本の帯が 1 駅のスコアで、
 * 区切りが指標ごとの寄与（正規化値 × 重み）。凡例に指標名と重みを出すので、
 * 「この駅は地価の安さで上がっている」といった読み方がその場でできる。
 *
 * ⚠ `rankingTable` パネルは使わない。あれは**単一指標**の表（`metricKey` と単位を持つ）で、
 * 合成スコアを流し込むと意味がずれる（§13.5-4）。
 */

import { HAZARD_LEVEL_COLORS, HAZARD_LEVEL_ICONS } from '@/shared/constants'
import type { RecommendMetric, RecommendResponse, RecommendRow } from '@/shared/api'
import { cn } from '@/lib/utils'
import { contributionColor } from './colors'
import { barScale, barWidth, percentJa, scoreJa } from './summary'

/** 危険度のバッジ（色＋記号＋ラベルの 3 重）。**判定できない駅は灰色で「不明」**。 */
function HazardBadge({ hazard }: { hazard: NonNullable<RecommendRow['hazard']> }) {
  const color = hazard.level === null ? '#94a3b8' : HAZARD_LEVEL_COLORS[hazard.level]
  const icon = hazard.level === null ? '?' : HAZARD_LEVEL_ICONS[hazard.level]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white"
      style={{ backgroundColor: color }}
      title={hazard.worstJa ?? hazard.levelJa}
    >
      <span aria-hidden>{icon}</span>
      {hazard.levelJa}
    </span>
  )
}

/** 指標ごとの寄与を積んだ 1 本の帯。合計＝合成スコア。 */
function ScoreBar({
  row,
  metrics,
  scale,
}: {
  row: RecommendRow
  metrics: readonly RecommendMetric[]
  scale: number
}) {
  if (scale <= 0) return null
  return (
    <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
      {row.breakdown.map((item, index) => (
        <div
          key={item.key}
          style={{
            width: `${barWidth(item.contribution, scale)}%`,
            backgroundColor: contributionColor(index),
          }}
          title={`${metrics[index]?.shortLabelJa ?? item.key} ${item.formatted}`}
        />
      ))}
    </div>
  )
}

/** 凡例＝重みの表示でもある（どの色が何の指標で、どれだけ効いているか）。 */
export function WeightLegend({ metrics }: { metrics: readonly RecommendMetric[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {metrics.map((metric, index) => (
        <li
          key={metric.key}
          className="flex items-center gap-1.5 text-xs text-slate-600"
          title={metric.labelJa}
        >
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: contributionColor(index) }}
            aria-hidden
          />
          <span className="font-medium text-slate-700">{metric.shortLabelJa}</span>
          <span className="tabular-nums text-slate-500">{percentJa(metric.weight)}</span>
          <span className="text-slate-400">{metric.directionJa}</span>
          {metric.degenerate !== null && <span className="text-amber-600">差が付かず</span>}
        </li>
      ))}
    </ul>
  )
}

export function RecommendTable({
  response,
  onSelect,
}: {
  response: RecommendResponse
  onSelect: (grp: string) => void
}) {
  const scale = barScale(response.rows)
  return (
    <ol className="divide-y divide-slate-100">
      {response.rows.map((row) => (
        <li key={row.grp}>
          <button
            type="button"
            onClick={() => onSelect(row.grp)}
            className="w-full cursor-pointer rounded-lg px-2 py-2 text-left hover:bg-indigo-50"
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="w-6 shrink-0 text-right text-slate-400 tabular-nums">
                {row.rank}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-slate-800">{row.name}</span>
                <span className="ml-1.5 text-xs text-slate-400">
                  {row.municipality ?? row.prefecture}
                </span>
                {row.breakdown.some((item) => item.flagged) && (
                  <span className="ml-1 text-amber-600" title="値が信用できない指標があります">
                    ⚠
                  </span>
                )}
              </span>
              {row.hazard !== null && <HazardBadge hazard={row.hazard} />}
              {row.hazard !== null && row.hazard.penalty > 0 && (
                <span className="shrink-0 text-xs text-rose-600 tabular-nums">
                  −{row.hazard.penalty.toFixed(2)}
                </span>
              )}
              <span
                className={cn(
                  'w-12 shrink-0 text-right font-semibold tabular-nums',
                  row.rank <= response.topN ? 'text-slate-900' : 'text-slate-600',
                )}
              >
                {scoreJa(row.score)}
              </span>
            </div>
            <ScoreBar row={row} metrics={response.metrics} scale={scale} />
          </button>
        </li>
      ))}
    </ol>
  )
}
