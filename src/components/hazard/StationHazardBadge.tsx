'use client'

/**
 * 駅カードに添える災害バッジ（`docs/260824_flood.md` §7.2）。
 *
 * **駅詳細のタブは増やさない。** タブ帯は 8 タブ＝516px で既にパネル幅 420px を超えており、
 * 9 タブ目はレイアウトの不変条件（`tests/panel-layout.test.ts`）を壊す。
 * 代わりに 1 行のバッジを置き、押すと**現在地カードと同じ `hazardCard`** をその場で開く。
 *
 * 意味づけは一切ここに書かない——危険度・文言・出典・免責はすべて共通API が決めている。
 * このコンポーネントがやるのは「1 行に畳む／開く」だけである。
 */

import { useState } from 'react'
import { HAZARD_LEVEL_COLORS, HAZARD_LEVEL_ICONS, HAZARD_LEVEL_LABELS_JA } from '@/shared/constants'
import { hazardBadgeJa, hazardCardPanel, STATION_HAZARD_CAVEAT_JA } from '@/domain/hazard/panels'
import { PanelRenderer } from '@/components/panels/PanelRenderer'
import { useHazardPoint } from './useHazardPoint'
import { cn } from '@/lib/utils'

export type StationHazardBadgeProps = {
  readonly lon: number
  readonly lat: number
  readonly stationName: string
}

function Skeleton() {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
      <span className="size-3 animate-pulse rounded-sm bg-slate-200" aria-hidden />
      災害リスクを確認しています…
    </div>
  )
}

export function StationHazardBadge({ lon, lat, stationName }: StationHazardBadgeProps) {
  const [open, setOpen] = useState(false)
  const { point, isLoading } = useHazardPoint({ lon, lat, placeJa: stationName })

  if (point === undefined) return isLoading ? <Skeleton /> : null

  const { level } = point.verdict
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: HAZARD_LEVEL_COLORS[level] }}
        >
          <span aria-hidden>{HAZARD_LEVEL_ICONS[level]}</span>
          {HAZARD_LEVEL_LABELS_JA[level]}
        </span>
        {/* 折り返す（切り詰めない）。「洪水 3.62m・3〜5m 未満」の m 値がいちばん効く情報で、
            そこが「…」で消えると、バッジを置いた意味が無くなる。 */}
        <span className="min-w-0 flex-1 text-xs break-words text-slate-600">
          {hazardBadgeJa(point)}
        </span>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
            open ? 'bg-slate-100 text-slate-600' : 'text-indigo-600 hover:bg-indigo-50',
          )}
        >
          {open ? '閉じる' : '詳しく見る'}
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">{STATION_HAZARD_CAVEAT_JA}</p>
      {open && (
        <div className="mt-2 rounded-xl bg-slate-50 p-2">
          <PanelRenderer panel={hazardCardPanel(point, 'compact')} />
        </div>
      )}
    </div>
  )
}
