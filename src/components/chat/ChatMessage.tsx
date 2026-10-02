'use client'

/**
 * チャット 1 メッセージの描画。ユーザーは右吹き出し、アシスタントは本文（駅名チップ化）＋図。
 *
 * 図は、画面幅に応じて**参照チップ**（実体はキャンバス・右の駅詳細・260802）か、**会話の中**
 * （compact・⤢ で拡大・2026-10-02）に出す。出し分けは `presentation.ts`。
 * 昇格先が無いグループ（markdown・ハザードのカード等）は、どの幅でもその場に描く。
 */

import { type MapResponse } from '@/shared/protocol'
import { PanelStack } from '@/components/panels/PanelRenderer'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { type ChatUIMessage } from './types'
import { buildPanelGroups, type PanelGroup } from './panelGroups'
import { QUESTION_MARKER } from './followScroll'
import { displayTextOf, mapResponseOf, panelPromotionsOf, textOf } from './messageParts'
import { InlineFigure } from './InlineFigure'
import { PanelChip } from './PanelChip'
import { presentationOf, type Viewport } from './presentation'
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

/** 回答の 1 グループ（図 1 つ・または昇格先の無いパネル）。 */
function AnswerGroup({ group, viewport }: { group: PanelGroup; viewport: Viewport }) {
  const { setGrp } = useMapUrlState()
  const promotion = group.promotion

  if (promotion === null) {
    // 昇格先が無い＝図ではない（markdown 等）。テキストと同じ扱いでその場に出す。
    return (
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <PanelStack panels={group.panels} onSelect={(grp) => void setGrp(grp)} />
      </div>
    )
  }
  return presentationOf(promotion.kind, viewport) === 'inline' ? (
    <InlineFigure group={group} promotion={promotion} />
  ) : (
    <PanelChip group={group} promotion={promotion} />
  )
}

export function ChatMessage({ message, viewport }: { message: ChatUIMessage; viewport: Viewport }) {
  const { setGrp } = useMapUrlState()

  if (message.role === 'user') {
    // 印＝回答が長いとき、スレッドをこの質問の頭で止める（`useChatScroll`・追従先）。
    return (
      <div
        {...QUESTION_MARKER}
        className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm whitespace-pre-wrap text-white"
      >
        {textOf(message.parts)}
      </div>
    )
  }

  const text = displayTextOf(message.parts)
  const response = mapResponseOf(message.parts)
  const groups =
    response === null ? [] : buildPanelGroups(response.panels, panelPromotionsOf(message.parts))
  const dict = response === null ? new Map<string, string>() : nameToGrp(response)

  return (
    <div className="mr-auto max-w-full space-y-2">
      {text.length > 0 && (
        <div className="rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">
          <RichText text={text} nameToGrp={dict} onSelect={(grp) => void setGrp(grp)} />
        </div>
      )}
      {groups.map((group, index) => (
        <AnswerGroup key={index} group={group} viewport={viewport} />
      ))}
    </div>
  )
}
