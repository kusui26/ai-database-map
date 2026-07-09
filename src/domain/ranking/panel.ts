/**
 * ドメイン：RankingResponse → GUI Chat Protocol の rankingTable Panel（純関数）。
 * クリックUI（P6a のダイアログ）と Step2 のチャットが同一 Panel を描画する（.claude/CLAUDE.md §2）。
 */

import { type RankingResponse } from '@/shared/api'
import { prefectureLabel } from '@/shared/constants'
import { type PanelSize, type RankingTablePanel } from '@/shared/protocol'

export function rankingPanel(
  response: RankingResponse,
  size: PanelSize = 'full',
): RankingTablePanel {
  const direction = response.order === 'desc' ? '上位' : '下位'
  return {
    type: 'rankingTable',
    title: `${response.metric.labelJa}（${prefectureLabel(response.prefectures)}・${direction}）`,
    metricKey: response.metric.key,
    unit: response.metric.unit,
    rows: response.rows,
    size,
  }
}
