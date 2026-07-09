/**
 * ドメイン：GrowthResponse → GUI Chat Protocol の scatter Panel（純関数）。
 * クリックUI（P6b のダイアログ）と Step2 のチャットが同一 Panel を描画する（.claude/CLAUDE.md §2）。
 */

import { type GrowthResponse } from '@/shared/api'
import { prefectureLabel } from '@/shared/constants'
import { type PanelSize, type ScatterPanel } from '@/shared/protocol'

export function scatterPanel(response: GrowthResponse, size: PanelSize = 'full'): ScatterPanel {
  const scope = prefectureLabel(response.prefectures)
  return {
    type: 'scatter',
    title: `${response.x.labelJa} × ${response.y.labelJa}（${scope}）`,
    xLabel: response.x.labelJa,
    yLabel: response.y.labelJa,
    xUnit: response.x.unit,
    yUnit: response.y.unit,
    points: response.points,
    clusterCount: response.clusterCount,
    size,
  }
}
