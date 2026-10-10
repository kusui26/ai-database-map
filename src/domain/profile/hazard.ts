/**
 * ドメイン：駅周辺のプロフィールに載せる**災害の要約**（純関数・2026-10-09 B4）。
 *
 * 材料は駅別ハザードの事前計算（`station_hazard`・`get_hazard_summary` と同じもの）。地点の照会（浸水ナビ・公式タイル）を
 * 駅ごとに走らせずに済み、プロフィールを 1 回の往復で返せる。言い方の規約は既存の災害の答え方のまま：
 *
 * - **「安全」と言わない**：該当なしは「指定区域に入っていない」まで。区域図の無い災害は別に挙げる
 * - **時制**：想定最大規模の「もし起きたら」で、いまの警報ではない。駅の代表点 1 点の値
 * - 危険度（順序尺度）はそのまま渡し、画面は語ではなく色・記号で示す（`StationHazardBadge` と同じ）
 */

import { HAZARD_GROUP_LABELS_JA, hazardLevelWeight } from '@/shared/constants'
import {
  SUMMARY_HAZARD_GROUPS,
  type StationHazardSummary,
  type SummaryHazardGroup,
} from '@/shared/hazard-summary'
import { type ProfileHazard } from '@/shared/profile'
import { HAZARD_TENSE_ASSUMED_NOTE_JA, STATION_HAZARD_CAVEAT_JA } from '@/domain/hazard/panels'
import { hazardSummarySources } from '@/domain/hazard/summary'

/** 必ず添える限界（代表点 1 点・想定最大規模・いまの警報ではない）。 */
export const PROFILE_HAZARD_CAVEAT_JA = `${STATION_HAZARD_CAVEAT_JA}${HAZARD_TENSE_ASSUMED_NOTE_JA}`

function labelOf(group: SummaryHazardGroup): string {
  return HAZARD_GROUP_LABELS_JA[group]
}

/** 該当した災害（重い順・同じ重さは要約の並び）。「洪水：洪水浸水想定区域（想定最大規模）：0.5〜3m 未満」。 */
function hitsOf(summary: StationHazardSummary): string[] {
  return SUMMARY_HAZARD_GROUPS.filter((group) => summary.groups[group].level !== 'none')
    .sort(
      (a, b) =>
        hazardLevelWeight(summary.groups[b].level) - hazardLevelWeight(summary.groups[a].level),
    )
    .map((group) => `${labelOf(group)}：${summary.groups[group].worstJa ?? '該当あり'}`)
}

/** 事前計算の要約 → プロフィールの災害（事前計算が無い駅は null＝分からない）。 */
export function profileHazardOf(summary: StationHazardSummary | null): ProfileHazard | null {
  if (summary === null) return null
  const groups = SUMMARY_HAZARD_GROUPS
  return {
    level: summary.level,
    headlineJa: summary.headlineJa,
    hitsJa: hitsOf(summary),
    // 該当したグループの「近く」は言わない（もう区域に入っている）。
    nearbyJa: groups
      .filter((group) => summary.groups[group].nearby && summary.groups[group].level === 'none')
      .map(labelOf),
    uncoveredJa: groups.filter((group) => summary.groups[group].uncovered).map(labelOf),
    caveatJa: PROFILE_HAZARD_CAVEAT_JA,
    sources: [...hazardSummarySources()],
  }
}
