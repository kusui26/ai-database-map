'use client'

/**
 * エリアの選び方：いまの地図の範囲（2026-10-15 B5e・§6.12.10）。
 *
 * 範囲はパネル（チャット欄・駅詳細）に隠れていない部分（`mapStore` の `viewport`・チャットの「このあたり」と同じ）。
 * 区域の値（国勢調査の公表値など）は出ない——地図の範囲の区域の値は B5 では作らない（§12-24）。駅の周りの値と色分けは出る。
 */

import { formatAreaRef } from '@/shared/area-ref'
import { useMapStore } from '@/stores/mapStore'
import { SubmitButton } from './SubmitButton'

export function MapAreaTab({
  submitJa,
  onPick,
}: {
  submitJa: string
  onPick: (ref: string) => void
}) {
  const viewport = useMapStore((state) => state.viewport)
  const submit = (): void => {
    if (viewport !== null) onPick(formatAreaRef({ type: 'bbox', bbox: viewport }))
  }
  return (
    <>
      <p className="text-xs leading-relaxed text-slate-500">
        いま地図に見えている範囲の駅でまとめます。区域の値（国勢調査の人口など）は出ません。
      </p>
      {viewport === null && <p className="text-xs text-slate-400">地図の読み込みを待っています…</p>}
      <SubmitButton disabled={viewport === null} onClick={submit}>
        {submitJa}
      </SubmitButton>
    </>
  )
}
