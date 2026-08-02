/**
 * 「直近の回答をキャンバスに出すべきか」を決める純関数（260802）。
 *
 * 散布・ランキングだけがキャンバスの対象。駅詳細は `selectStation` で
 * **右ドロワーが自動で開く**ため対象外（docs/260802_ai_chat_canvs.md §4）。
 *
 * `key` は「どの回答の、どの条件か」を表す。呼び出し側は**この key が変わったときだけ**
 * 適用することで、(1) 初期表示では出さない (2) ストリーミング中に同じ図で開き直さない
 * (3) ユーザーが閉じたあと勝手に開き直さない、を同時に満たす（§5）。
 */

import { type Promotion } from '@/stores/chatStore'
import { type ChatUIMessage } from './types'
import { buildPanelGroups, toolCallsOf } from './panelGroups'
import { mapResponseOf } from './messageParts'

export type CanvasTarget = {
  /** 回答 ID ＋ 条件。同じ図なら同じ値になる。 */
  readonly key: string
  readonly promotion: Promotion
}

/** キャンバスで開ける昇格か（駅詳細は右ドロワーが担当する）。 */
function isCanvasKind(promotion: Promotion | { readonly kind: string } | null): boolean {
  return promotion !== null && (promotion.kind === 'scatter' || promotion.kind === 'ranking')
}

/**
 * 直近のアシスタント応答からキャンバスの表示対象を求める（無ければ null）。
 * 応答に複数の図があるときは**最後のもの**を採る（assemble は 詳細 → ランキング → 散布 の順で並べる）。
 */
export function canvasTargetOf(messages: readonly ChatUIMessage[]): CanvasTarget | null {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'assistant')
  if (message === undefined) return null

  const response = mapResponseOf(message.parts)
  if (response === null) return null

  const groups = buildPanelGroups(response.panels, toolCallsOf(message.parts))
  const promotions = groups
    .map((group) => group.promotion)
    .filter((promotion): promotion is Promotion => isCanvasKind(promotion))
  const promotion = promotions[promotions.length - 1]
  if (promotion === undefined) return null

  return { key: `${message.id}:${JSON.stringify(promotion)}`, promotion }
}
