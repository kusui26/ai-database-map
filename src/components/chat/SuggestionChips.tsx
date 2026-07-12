'use client'

/**
 * サジェストチップ（plan_fable §2.4）。初回は代表的な 3 問、会話開始後は文脈追従の候補。
 * 駅選択中は「その駅」を掘り下げる候補を出す（駅名は不要な汎用表現でクリック→送信）。
 */

import { useMapUrlState } from '@/components/map/useMapUrlState'

const INITIAL: readonly string[] = [
  '東京駅の人口推移を見せて',
  '神奈川県の乗降客の増加が大きい駅は？',
  '品川駅について教えて',
]

const AFTER_STATION: readonly string[] = [
  'この駅の地価の推移は？',
  '半径5kmで詳しく',
  '近くの駅と比べて',
]

const AFTER_GENERAL: readonly string[] = [
  '全国で人口が増えた駅ランキング',
  '千葉県で地価が上がった駅は？',
]

export function SuggestionChips({
  hasMessages,
  onPick,
}: {
  hasMessages: boolean
  onPick: (text: string) => void
}) {
  const { grp } = useMapUrlState()
  const chips = !hasMessages ? INITIAL : grp !== null ? AFTER_STATION : AFTER_GENERAL

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => onPick(chip)}
          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
        >
          {chip}
        </button>
      ))}
    </div>
  )
}
