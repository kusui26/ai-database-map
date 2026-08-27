'use client'

/**
 * 駅詳細の「災害」タブの中身（`docs/260828_fix_flood.md` §4.3 の②「もし起きたら」）。
 *
 * 出すのは**現在地カードと同じ `hazardCard`**——同じ共通API・同じドメイン関数を通るので、
 * 地図をクリックしたときの答えと食い違わない（`.claude/CLAUDE.md` §2）。
 *
 * **バッジと同じ SWR キー**（`useHazardPoint` に同じ `HazardTarget` を渡す）なので、
 * タブを開いても**追加の通信は起きない**。
 *
 * ⚠ ここは PR-1 の器である。①「いま」（PR-2）と③「逃げる」（PR-3）は、この上下に足す。
 */

import { hazardCardPanel } from '@/domain/hazard/panels'
import { PanelRenderer } from '@/components/panels/PanelRenderer'
import { useHazardPoint, type HazardTarget } from './useHazardPoint'

/** 取得に失敗したときの言い方（**「該当なし」と混同させない**）。 */
function Unavailable({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400">
      {isLoading ? '災害リスクを調べています…' : '災害の情報を取得できませんでした。'}
    </div>
  )
}

export function StationHazardTab({ target }: { target: HazardTarget }) {
  const { point, isLoading } = useHazardPoint(target)
  if (point === undefined) return <Unavailable isLoading={isLoading} />
  return <PanelRenderer panel={hazardCardPanel(point)} />
}
