/**
 * ドメイン：地点のハザード応答 → **駅別サマリへの射影**（純関数・PR-6）。
 *
 * ビルダー（`pipeline/build_station_hazard.ts`）と整合検証（§11）が同じこの射影を通る。
 * 形は `shared/hazard-summary`（DB・応答と共通）。ここはカタログ（グループ対応）だけを足す。
 *
 * ⚠ 事前計算は**浸水ナビ（河川別の実測 m）を含めない**（`docs/260828_research_claude_auth.md`
 * §10 PR-6 方針）。区分値（タイル・メッシュ）の階級は実測 m と同じ想定（想定最大規模）を
 * 描いたものなので、**レベル（順序尺度）はどちらで解決しても一致する**。
 */

import { getHazardLayer } from '@/shared/hazard'
import { hazardLevelWeight, type HazardLevel } from '@/shared/constants'
import type { HazardPointResponse } from '@/shared/api'
import {
  SUMMARY_HAZARD_GROUPS,
  type HazardGroupSummary,
  type StationHazardSummary,
  type SummaryHazardGroup,
} from '@/shared/hazard-summary'
import { hazardLayersWithPointAnswer } from './catalog'

function isSummaryGroup(value: unknown): value is SummaryHazardGroup {
  return SUMMARY_HAZARD_GROUPS.some((group) => group === value)
}

/** レイヤ key → サマリのグループ（対象外＝terrain/realtime/未知は null）。 */
function summaryGroupOf(layerKey: string): SummaryHazardGroup | null {
  const group = getHazardLayer(layerKey)?.group
  return isSummaryGroup(group) ? group : null
}

/** 危険度の最重（`domain/hazard/catalog.heaviestHazardLevel` と同じ規則・重み比較）。 */
function heaviest(levels: readonly HazardLevel[]): HazardLevel {
  return levels.reduce<HazardLevel>(
    (worst, level) => (hazardLevelWeight(level) > hazardLevelWeight(worst) ? level : worst),
    'none',
  )
}

function groupSummary(
  group: SummaryHazardGroup,
  point: HazardPointResponse,
  uncoveredLayerKeys: readonly string[],
): HazardGroupSummary {
  // point.hazards は危険度の重い順（pointHazard が並べ済み）＝グループ内の先頭が最重。
  const items = point.hazards.filter((item) => summaryGroupOf(item.layerKey) === group)
  const worst = items[0]
  return {
    level: heaviest(items.map((item) => item.level)),
    worstJa: worst === undefined ? null : `${worst.labelJa}：${worst.valueJa}`,
    nearby: point.neighbours.some((each) => summaryGroupOf(each.layerKey) === group),
    uncovered: uncoveredLayerKeys.some((key) => summaryGroupOf(key) === group),
  }
}

/** 地点の応答 → 駅別サマリ（`uncoveredLayerKeys` は `HazardPointResult` が運ぶ）。 */
export function stationHazardSummary(
  grp: string,
  point: HazardPointResponse,
  uncoveredLayerKeys: readonly string[],
): StationHazardSummary {
  return {
    grp,
    level: point.verdict.level,
    evacuation: point.verdict.evacuation,
    headlineJa: point.verdict.headlineJa,
    certainty: point.certainty,
    elevationM: point.terrain.elevMeanM,
    groups: {
      flood: groupSummary('flood', point, uncoveredLayerKeys),
      inland_flood: groupSummary('inland_flood', point, uncoveredLayerKeys),
      storm_surge: groupSummary('storm_surge', point, uncoveredLayerKeys),
      tsunami: groupSummary('tsunami', point, uncoveredLayerKeys),
      landslide: groupSummary('landslide', point, uncoveredLayerKeys),
    },
  }
}

/**
 * サマリの限界（**必ず応答・meta に同梱する**・§5.3 ③）。
 * 落とした瞬間に「none＝安全」「事前計算＝今」の誤読が生まれる。
 */
export const HAZARD_SUMMARY_LIMITATIONS_JA: readonly string[] = [
  '駅の代表点 1 点（250m メッシュ／タイル画素）の判定で、駅周辺全体ではない',
  '想定最大規模の「もし起きたら」であり、現在の状況ではない（いまの警報は get_hazard_alerts で）',
  'none は「区域図の上で該当なし」。uncovered（図なし）の駅を安全と読まない',
  '河川別の実測浸水深・到達/継続時間（浸水ナビ）は含まない。個別の駅は get_hazard_at_point で確認する',
  'レベルは順序尺度（none<caution<warning<danger<critical）。足し算・平均・線形の重み付けはできない',
]

/** サマリが参照するレイヤ群の出典（カタログから導く。手で書かない）。 */
export function hazardSummarySources(): readonly { source: string; license: string }[] {
  const seen = new Map<string, { source: string; license: string }>()
  for (const key of hazardLayersWithPointAnswer()) {
    const layer = getHazardLayer(key)
    if (layer === undefined || !isSummaryGroup(layer.group)) continue
    seen.set(`${layer.source} ${layer.license}`, { source: layer.source, license: layer.license })
  }
  return [...seen.values()]
}
