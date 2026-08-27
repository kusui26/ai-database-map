'use client'

/**
 * サジェストチップ（plan_fable §2.4）。初回は代表的な 3 問、会話開始後は文脈追従の候補。
 * 駅選択中は「その駅」を掘り下げる候補を出す（駅名は不要な汎用表現でクリック→送信）。
 *
 * ⚠ **災害の問いを必ず 1 つ入れる。** AI は災害に答えられる（`getHazardAtPoint` ほか）のに、
 * サジェストが人口・地価・バスだけだった頃は**そもそも聞かれなかった**。
 * 「何が聞けるか」を示すのがこのチップの役目なので、答えられることは出す。
 */

import { useMapUrlState } from '@/components/map/useMapUrlState'

const INITIAL: readonly string[] = [
  '東京駅の人口推移を見せて',
  '亀有駅は浸水しますか？',
  '神奈川県の乗降客の増加が大きい駅は？',
  '品川駅について教えて',
]

// 駅選択中の掘り下げ（「この駅」はサーバの地図文脈が選択駅に解決＝P8e）。
const AFTER_STATION: readonly string[] = [
  'この駅の人口推移は？',
  'この駅の地価の推移は？',
  'この駅の水害リスクは？',
  'この駅の近くの避難場所は？',
  'この駅のバス停の数は？',
  'この駅の事業所数は？',
  'この駅の従業者数は？',
  '半径5kmで詳しく',
]

const AFTER_GENERAL: readonly string[] = [
  '全国で人口が増えた駅ランキング',
  '千葉県で地価が上がった駅は？',
  'いま警報は出ていますか？',
]

export function SuggestionChips({
  hasMessages,
  onPick,
}: {
  hasMessages: boolean
  onPick: (text: string) => void
}) {
  const { grp } = useMapUrlState()
  // 駅選択中は会話の有無に依らず掘り下げサジェストを出す（選んですぐ「ポチポチ」探索できる・P8e）。
  const chips = grp !== null ? AFTER_STATION : hasMessages ? AFTER_GENERAL : INITIAL

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
