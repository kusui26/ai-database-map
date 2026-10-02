/**
 * 順位表のうち、画面に出す行（2026-10-02・`docs/261001_fix_user_feedback_ui.md` A4）。
 *
 * 会話の中の順位表（compact）は**上位だけ**を出す。AI のランキングは既定で 20 行（最大 50 行）あり、
 * 全部並べると携帯ではチャットの枠の 2〜3 倍の高さになって、本文と次の質問が遠くなる。
 * 残りは ⤢ で開くモーダル（full・もっと見るで全件）で見る。キャンバス・モーダルの表は full なので切らない。
 */

import { type RankingRow, type RankingTablePanel } from '@/shared/protocol'

/** 会話の中に出す行数（上位 10）。 */
export const COMPACT_RANKING_ROWS = 10

export type VisibleRankingRows = {
  readonly rows: readonly RankingRow[]
  /** 出さなかった行の数（0 なら全部出している）。 */
  readonly hiddenCount: number
}

/** 表に出す行と、出さなかった行の数。 */
export function visibleRankingRows(panel: RankingTablePanel): VisibleRankingRows {
  if (panel.size !== 'compact') return { rows: panel.rows, hiddenCount: 0 }
  const rows = panel.rows.slice(0, COMPACT_RANKING_ROWS)
  return { rows, hiddenCount: panel.rows.length - rows.length }
}
