'use client'

/**
 * Panel[] のジェネリックなレンダラ（type で分岐）。
 * クリック由来の詳細パネル（P5）と Step2 のチャット応答が、同一の Panel を同じ経路で描画する
 * （.claude/CLAUDE.md §2）。新パネル種別はここに 1 分岐足すだけで両者に反映される。
 */

import { type Panel } from '@/shared/protocol'
import { cn } from '@/lib/utils'
import { StationCard } from './StationCard'
import { TrendChart } from './TrendChart'
import { StatTable } from './StatTable'
import { BarChart } from './BarChart'
import { RankingTable } from './RankingTable'

export function PanelRenderer({ panel }: { panel: Panel }) {
  switch (panel.type) {
    case 'stationCard':
      return <StationCard panel={panel} />
    case 'trendChart':
      return <TrendChart panel={panel} />
    case 'statTable':
      return <StatTable panel={panel} />
    case 'barChart':
      return <BarChart panel={panel} />
    case 'markdown':
      return <p className="text-sm whitespace-pre-wrap text-slate-700">{panel.body}</p>
    case 'rankingTable':
      return <RankingTable panel={panel} />
    case 'scatter':
      return (
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-400">
          「{panel.title}」は P6b で実装します。
        </div>
      )
    default: {
      const exhaustive: never = panel
      return exhaustive
    }
  }
}

/** Panel[] を縦に積む（詳細タブ・チャット吹き出し共通）。 */
export function PanelStack({
  panels,
  className,
}: {
  panels: readonly Panel[]
  className?: string
}) {
  return (
    <div className={cn('space-y-4', className)}>
      {panels.map((panel, index) => (
        <PanelRenderer key={`${panel.type}-${index}`} panel={panel} />
      ))}
    </div>
  )
}
