'use client'

/**
 * チャット 1 メッセージの描画。ユーザーは右吹き出し、アシスタントは本文（駅名チップ化）＋
 * 図への**参照チップ**（図の実体はキャンバス／モーダル側・260802）。
 * 昇格先が無いグループ（markdown 等）だけは、従来どおりその場に描く。
 */

import { type MapResponse } from '@/shared/protocol'
import { PanelStack } from '@/components/panels/PanelRenderer'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { type ChatUIMessage } from './types'
import { buildPanelGroups, toolCallsOf } from './panelGroups'
import { textOf, mapResponseOf } from './messageParts'
import { PanelChip } from './PanelChip'
import { RichText } from './richText'

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
      {groups.map((group, index) =>
        group.promotion === null ? (
          // 昇格先が無い＝図ではない（markdown 等）。テキストと同じ扱いでその場に出す。
          <div key={index} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <PanelStack panels={group.panels} onSelect={(grp) => void setGrp(grp)} />
          </div>
        ) : (
          <PanelChip key={index} group={group} promotion={group.promotion} />
        ),
      )}
    </div>
  )
}
