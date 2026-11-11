'use client'

/**
 * 駅詳細の「概要」タブ（駅周辺のプロフィール・2026-10-09 B4・`docs/261001_fix_user_feedback_ui.md` §6.4・§12-7）。
 *
 * 中身はチャットの回答（`getStationProfile`）と同じ `stationProfile` パネル——同じ共通 API・同じドメイン関数を通るので、
 * 画面で見たものと AI が説明するものが食い違わない（.claude/CLAUDE.md §2）。
 *
 * - 位置は半径で変わるので、指標のタブと同じ集計半径のセレクタを置く（`?r`）
 * - 災害はここに出さない。**災害は地価の右の「災害」タブで見る**——2 か所に書くと、事前計算（ここ）と
 *   地点の照会（タブ）の言い回しの違いが食い違いに見える。タブは開いたときから見えるので、案内の文も置かない
 *   （2026-11-11・`docs/261110_fix_PLAN.md` §7.1 案 B。以前はヘッダのバッジを指す 1 行を置いていた）
 * - 駅を替えた直後は前の駅のプロフィールを出さない（SWR の keepPreviousData は半径の切り替えのためだけ）
 */

import { stationProfilePanel } from '@/domain/profile/panel'
import { StationProfile } from '@/components/panels/StationProfile'
import { messageJaOf } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'
import { useStationProfile } from './useStationProfile'

function Loading() {
  return <div className="grid h-40 place-items-center text-sm text-slate-400">読み込み中…</div>
}

export function StationOverviewTab({ grp, radiusM }: { grp: string; radiusM: number }) {
  const { profile, error } = useStationProfile(grp, radiusM)
  if (error !== undefined) {
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
        {messageJaOf(
          error,
          '駅周辺のプロフィールを取得できませんでした。時間をおいて再度お試しください。',
        )}
      </div>
    )
  }
  // 前の駅のプロフィールは出さない。同じ駅で半径だけ違うなら、薄くして残す（更新中）。
  if (profile === undefined || profile.station.grp !== grp) return <Loading />
  const stale = profile.radiusM !== radiusM
  return (
    <div className={cn('transition-opacity', stale && 'opacity-50')} aria-busy={stale}>
      <StationProfile panel={stationProfilePanel(profile)} showHazard={false} />
    </div>
  )
}
