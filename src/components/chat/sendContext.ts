/**
 * チャットの送信に同送する地図の文脈（純関数・2026-10-08 L3）。
 *
 * - 選択中の駅と半径（P8e）：「この駅」「ここ」を解決する
 * - 地図の表示範囲（`bbox`・丸め済み）：同じ名前の路線（「中央線」＝JR・大阪メトロ）を決める
 *
 * どちらも無ければ何も送らない（以前の送信と同じ形）。
 */

import { viewportToTuple, type Viewport } from '@/shared/viewport'

/** `sendMessage` の第 2 引数（無ければ undefined）。 */
export type ChatSendOptions = { readonly body: Readonly<Record<string, unknown>> } | undefined

export function chatBody(
  grp: string | null,
  radiusM: number,
  viewport: Viewport | null,
): ChatSendOptions {
  const selected = grp === null ? {} : { selectedGrp: grp, radiusM }
  const range = viewport === null ? {} : { bbox: viewportToTuple(viewport) }
  const body = { ...selected, ...range }
  return Object.keys(body).length === 0 ? undefined : { body }
}
