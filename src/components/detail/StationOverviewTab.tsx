'use client'

/**
 * 駅詳細の「概要」タブ（駅周辺のプロフィール・2026-10-09 B4・`docs/261001_fix_user_feedback_ui.md` §6.4・§12-7）。
 *
 * 中身はチャットの回答（`getStationProfile`）と同じ `stationProfile` パネル——同じ共通 API・同じドメイン関数を通るので、
 * 画面で見たものと AI が説明するものが食い違わない（.claude/CLAUDE.md §2）。
 *
 * - 位置は半径で変わるので、指標のタブと同じ集計半径のセレクタを置く（`?r`）
 * - 災害はここに出さない。**ヘッダのバッジが同じ駅の災害を常に出している**——2 か所に書くと、事前計算（ここ）と
 *   地点の照会（バッジ）の言い回しの違いが食い違いに見える。代わりに「災害」タブへの入口を置く
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

function HazardPointer({ onOpen }: { onOpen: () => void }) {
  return (
    <p className="mt-3 text-xs text-slate-500">
      災害リスクは上のバッジのとおりです。
      <button
        type="button"
        onClick={onOpen}
        className="ml-1 font-medium text-indigo-600 underline-offset-2 hover:underline"
      >
        「災害」タブで詳しく見る
      </button>
    </p>
  )
}

export function StationOverviewTab({
  grp,
  radiusM,
  onOpenHazard,
}: {
  grp: string
  radiusM: number
  /** 「災害」タブへ切り替える。 */
  onOpenHazard: () => void
}) {
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
      <HazardPointer onOpen={onOpenHazard} />
    </div>
  )
}
