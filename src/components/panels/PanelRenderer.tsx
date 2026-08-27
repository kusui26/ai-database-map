'use client'

/**
 * Panel[] のジェネリックなレンダラ（type で分岐）。
 * クリック由来の詳細パネル（P5）と Step2 のチャット応答が、同一の Panel を同じ経路で描画する
 * （.claude/CLAUDE.md §2）。新パネル種別はここに 1 分岐足すだけで両者に反映される。
 */

import { type Panel } from '@/shared/protocol'
import { cn } from '@/lib/utils'
import { EscapeDirection } from './EscapeDirection'
import { EvacuationList } from './EvacuationList'
import { HazardCard } from './HazardCard'
import { StationCard } from './StationCard'
import { TrendChart } from './TrendChart'
import { StatTable } from './StatTable'
import { BarChart } from './BarChart'
import { RankingTable } from './RankingTable'
import { ScatterChart } from './ScatterChart'

export function PanelRenderer({
  panel,
  onSelect,
}: {
  panel: Panel
  /** 駅クリックで選択（ランキング行・散布点。チャット/モーダルで使う。詳細ドロワーでは未指定）。 */
  onSelect?: (grp: string) => void
}) {
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
      return <RankingTable panel={panel} onSelect={onSelect} />
    case 'scatter':
      return <ScatterChart panel={panel} onSelect={onSelect} />
    case 'hazardCard':
      return <HazardCard panel={panel} />
    case 'evacuationList':
      return <EvacuationList panel={panel} />
    case 'escapeDirection':
      return <EscapeDirection panel={panel} />
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
  onSelect,
}: {
  panels: readonly Panel[]
  className?: string
  onSelect?: (grp: string) => void
}) {
  return (
    <div className={cn('space-y-4', className)}>
      {panels.map((panel, index) => (
        <PanelRenderer key={`${panel.type}-${index}`} panel={panel} onSelect={onSelect} />
      ))}
    </div>
  )
}
