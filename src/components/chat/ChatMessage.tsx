'use client'

/**
 * チャット 1 メッセージの描画。ユーザーは右吹き出し、アシスタントは本文（駅名チップ化）＋
 * data-map のパネルを効果グループ単位のインラインカードで（既存部品で・新規描画コードなし）。
 */

import { type MapResponse } from '@/shared/protocol'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { type ChatUIMessage } from './types'
import { buildPanelGroups, toolCallsOf } from './panelGroups'
import { InlineCard } from './InlineCard'
import { RichText } from './richText'

type Part = ChatUIMessage['parts'][number]

/** text パートを連結。 */
function textOf(parts: readonly Part[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}

/** 最後の data-map（MapResponse）を取り出す。 */
function mapResponseOf(parts: readonly Part[]): MapResponse | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part !== undefined && part.type === 'data-map') return part.data
  }
  return null
}

/** 応答に出た駅名 → grp（本文リンク化の辞書。確実に grp が分かる範囲に限定）。 */
function nameToGrp(response: MapResponse): Map<string, string> {
  const dict = new Map<string, string>()
  for (const panel of response.panels) {
    if (panel.type === 'stationCard') dict.set(panel.stationName, panel.grp)
    else if (panel.type === 'rankingTable') {
      for (const row of panel.rows) dict.set(row.name, row.grp)
    } else if (panel.type === 'scatter') {
      for (const point of panel.points) dict.set(point.name, point.grp)
    }
  }
  return dict
}

export function ChatMessage({ message }: { message: ChatUIMessage }) {
  const { setGrp } = useMapUrlState()

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm whitespace-pre-wrap text-white">
        {textOf(message.parts)}
      </div>
    )
  }

  const text = textOf(message.parts)
  const response = mapResponseOf(message.parts)
  const groups =
    response === null ? [] : buildPanelGroups(response.panels, toolCallsOf(message.parts))
  const dict = response === null ? new Map<string, string>() : nameToGrp(response)

  return (
    <div className="mr-auto max-w-full space-y-2">
      {text.length > 0 && (
        <div className="rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">
          <RichText text={text} nameToGrp={dict} onSelect={(grp) => void setGrp(grp)} />
        </div>
      )}
      {groups.map((group, index) => (
        <InlineCard key={index} group={group} />
      ))}
    </div>
  )
}
