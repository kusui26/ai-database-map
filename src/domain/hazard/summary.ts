/**
 * ドメイン：地点のハザード応答 → **駅別サマリへの射影**（純関数・PR-6）。
 *
 * ビルダー（`pipeline/build_station_hazard.ts`）と整合検証（§11）が同じこの射影を通る。
 * 形は `shared/hazard-summary`（DB・応答と共通）。種類ごとの集計は、地点の応答の
 * `groupStates` と同じ `./groups` を通る（二重に書かない・`docs/261110_fix_PLAN.md` §8.4）。
 *
 * ⚠ 事前計算は**浸水ナビ（河川別の実測 m）を含めない**（`docs/260828_research_claude_auth.md`
 * §10 PR-6 方針）。区分値（タイル・メッシュ）の階級は実測 m と同じ想定（想定最大規模）を
 * 描いたものなので、**レベル（順序尺度）はどちらで解決しても一致する**。
 */

import { getHazardLayer } from '@/shared/hazard'
import type { HazardPointResponse } from '@/shared/api'
import type { StationHazardSummary } from '@/shared/hazard-summary'
import { hazardLayersWithPointAnswer } from './catalog'
import { hazardGroupSummary, isSummaryGroup } from './groups'

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
      flood: hazardGroupSummary('flood', point, uncoveredLayerKeys),
      inland_flood: hazardGroupSummary('inland_flood', point, uncoveredLayerKeys),
      storm_surge: hazardGroupSummary('storm_surge', point, uncoveredLayerKeys),
      tsunami: hazardGroupSummary('tsunami', point, uncoveredLayerKeys),
      landslide: hazardGroupSummary('landslide', point, uncoveredLayerKeys),
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
