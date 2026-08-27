'use client'

/**
 * 駅カードに添える災害バッジ（`docs/260824_flood.md` §7.2）。
 *
 * **1 行の入口に徹する。** 押すと**その場では開かず、駅詳細の「災害」タブへ切り替える**。
 * 9 タブ目は帯の外にあって既定では完全に隠れるので、ここが確実な入口になる。
 *
 * ⚠ **ここで中身を開いてはいけない**（`docs/260828_fix_flood.md` §5）。バッジは
 * **スクロールしないヘッダ**の中にあり、そこで伸びたぶんは外側の `overflow-hidden` に
 * 切り落とされる——実際にそれで「下が切れて読めない」が起きた。中身はタブ（＝スクロールする
 * 領域）に置く。この不変条件は `tests/panel-layout.test.ts` が静的に守る。
 *
 * 意味づけは一切ここに書かない——危険度・文言・出典・免責はすべて共通API が決めている。
 */

import { HAZARD_LEVEL_COLORS, HAZARD_LEVEL_ICONS, HAZARD_LEVEL_LABELS_JA } from '@/shared/constants'
import { hazardBadgeJa, STATION_HAZARD_CAVEAT_JA } from '@/domain/hazard/panels'
import { useHazardPoint, type HazardTarget } from './useHazardPoint'

export type StationHazardBadgeProps = {
  readonly target: HazardTarget
  /** 押されたとき（＝「災害」タブへ切り替える）。 */
  readonly onOpen: () => void
}

function Skeleton() {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
      <span className="size-3 animate-pulse rounded-sm bg-slate-200" aria-hidden />
      災害リスクを確認しています…
    </div>
  )
}

export function StationHazardBadge({ target, onOpen }: StationHazardBadgeProps) {
  const { point, isLoading } = useHazardPoint(target)

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
          onClick={onOpen}
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
        >
          詳しく見る
        </button>
      </div>
      {/* 限界は**常時表示**にする（§7.2）。押さないと読めない注意書きは、無いのと同じ。 */}
      <p className="mt-0.5 text-[11px] text-slate-400">{STATION_HAZARD_CAVEAT_JA}</p>
    </div>
  )
}
