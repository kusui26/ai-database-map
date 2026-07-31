/**
 * ドメイン：GrowthResponse → GUI Chat Protocol の scatter Panel（純関数）。
 * クリックUI（P6b のダイアログ）と Step2 のチャットが同一 Panel を描画する（.claude/CLAUDE.md §2）。
 */

import { type GrowthResponse } from '@/shared/api'
import { operatorLabel, prefectureLabel, routeLabel, routeTypeLabel } from '@/shared/constants'
import { type PanelSize, type ScatterPanel } from '@/shared/protocol'

/**
 * 図の対象範囲（都道府県＋運営会社＋路線・種別）。絞ったものだけを併記し、
 * ⤢ 昇格やチャット内カードでも「何で絞った図か」が残るようにする（260730・260731）。
 */
function scopeLabel(response: GrowthResponse): string {
  const scopes = [prefectureLabel(response.prefectures)]
  if (response.operators.length > 0) scopes.push(operatorLabel(response.operators))
  if (response.routes.length > 0) scopes.push(routeLabel(response.routes))
  if (response.routeTypes.length > 0) {
    scopes.push(response.routeTypes.map(routeTypeLabel).join('・'))
  }
  return scopes.join('・')
}

export function scatterPanel(response: GrowthResponse, size: PanelSize = 'full'): ScatterPanel {
  const scope = scopeLabel(response)
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
