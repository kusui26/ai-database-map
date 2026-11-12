/**
 * ドメイン：**災害の種類ごとの集計**（純関数・`docs/261110_fix_PLAN.md` §8.4）。
 *
 * 種類は洪水・内水・高潮・津波・土砂災害の 5 つ（地形は参考情報、リアルタイムは「いま」の話なので入れない）。
 * 地点の応答の `groupStates`（`point.ts`）と駅別サマリの `groups`（`summary.ts`）が、
 * **同じこの集計を通る**——二重に書くと、地点のカードと駅の一覧で違うことを言うアプリになる。
 */

import { getHazardLayer } from '@/shared/hazard'
import { HAZARD_GROUP_LABELS_JA, hazardLevelWeight, type HazardLevel } from '@/shared/constants'
import type { HazardNeighbour } from '@/shared/api'
import type { HazardGroupState, HazardGroupStateKind, HazardItem } from '@/shared/protocol'
import {
  SUMMARY_HAZARD_GROUPS,
  type HazardGroupSummary,
  type SummaryHazardGroup,
} from '@/shared/hazard-summary'
import { GROUP_STATE_LABELS_JA, notSafeNoteJa } from './wording'

/** 集計に要る地点の答え（`HazardPointResponse` の一部。組み立て途中でも渡せるように絞る）。 */
export type GroupedFindings = {
  /** 該当（危険度の重い順・`pointHazard` が並べ済み）。 */
  readonly hazards: readonly HazardItem[]
  /** 近接（近い順＝タイル（約 20m）が先）。 */
  readonly neighbours: readonly HazardNeighbour[]
}

export function isSummaryGroup(value: unknown): value is SummaryHazardGroup {
  return SUMMARY_HAZARD_GROUPS.some((group) => group === value)
}

/** レイヤ key → 種類（対象外＝terrain/realtime/未知は null）。 */
function summaryGroupOf(layerKey: string): SummaryHazardGroup | null {
  const group = getHazardLayer(layerKey)?.group
  return isSummaryGroup(group) ? group : null
}

function belongsTo(group: SummaryHazardGroup): (layerKey: string) => boolean {
  return (layerKey) => summaryGroupOf(layerKey) === group
}

/** 危険度の最重（`domain/hazard/catalog.heaviestHazardLevel` と同じ規則・重み比較）。 */
function heaviest(levels: readonly HazardLevel[]): HazardLevel {
  return levels.reduce<HazardLevel>(
    (worst, level) => (hazardLevelWeight(level) > hazardLevelWeight(worst) ? level : worst),
    'none',
  )
}

/** 1 種類ぶんの集計（駅別サマリの形・版 1。`uncoveredLayerKeys` は図の無かったレイヤ）。 */
export function hazardGroupSummary(
  group: SummaryHazardGroup,
  findings: GroupedFindings,
  uncoveredLayerKeys: readonly string[],
): HazardGroupSummary {
  const isMine = belongsTo(group)
  // 該当は重い順に並んでいる＝種類の中の先頭が最重。
  const items = findings.hazards.filter((item) => isMine(item.layerKey))
  const worst = items[0]
  return {
    level: heaviest(items.map((item) => item.level)),
    worstJa: worst === undefined ? null : `${worst.labelJa}：${worst.valueJa}`,
    nearby: findings.neighbours.some((each) => isMine(each.layerKey)),
    uncovered: uncoveredLayerKeys.some(isMine),
  }
}

/**
 * 1 種類の状態。**上から順に、最初に当てはまったもの**を採る（`docs/261110_fix_PLAN.md` §10.2）。
 *
 * 図なし・未確認を「該当なし」より先に置くのは、**図が無いのに、確かめていないのに「該当なし」と言わない**ため。
 * 図なしを未確認より先に置くのは、分かった事実（この地域に図が無い）の方が具体的だから。
 */
function stateOf(summary: HazardGroupSummary, unchecked: boolean): HazardGroupStateKind {
  if (summary.worstJa !== null) return 'hit'
  if (summary.nearby) return 'nearby'
  if (summary.uncovered) return 'uncovered'
  return unchecked ? 'unknown' : 'none'
}

/** すぐ近くの区域の距離感（近接は近い順なので、その種類の先頭がいちばん近い）。 */
function proximityJaOf(group: SummaryHazardGroup, findings: GroupedFindings): string | null {
  const isMine = belongsTo(group)
  return findings.neighbours.find((each) => isMine(each.layerKey))?.proximityJa ?? null
}

/**
 * 5 種類の状態（必ず 5 つ・種類の順）。
 *
 * @param uncoveredLayerKeys この地域に区域図が無かったレイヤ
 * @param uncheckedLayerKeys 確かめられなかったレイヤ（公式の地図に届かず、250m メッシュにも無い）
 */
export function hazardGroupStates(
  findings: GroupedFindings,
  uncoveredLayerKeys: readonly string[],
  uncheckedLayerKeys: readonly string[],
): readonly HazardGroupState[] {
  return SUMMARY_HAZARD_GROUPS.map((group) => {
    const summary = hazardGroupSummary(group, findings, uncoveredLayerKeys)
    const state = stateOf(summary, uncheckedLayerKeys.some(belongsTo(group)))
    return {
      group,
      labelJa: HAZARD_GROUP_LABELS_JA[group],
      state,
      stateJa: GROUP_STATE_LABELS_JA[state],
      proximityJa: state === 'nearby' ? proximityJaOf(group, findings) : null,
    }
  })
}

/**
 * 「安全」と読まれかねない状態（該当でも、すぐ近くでもないもの）。注意の文で挙げる順。
 * すぐ近くは入れない——「すぐ近くに区域」は、それ自体が注意として読める。
 */
const QUIET_STATES: readonly HazardGroupStateKind[] = ['none', 'uncovered', 'unknown']

/**
 * 畳まずに見せる注意（`docs/261110_fix_PLAN.md` §8.4・§2.2）。
 * 該当なし・図なし・未確認の種類が 1 つでもあれば、**それを安全と読ませない 1 文**を必ず持つ。
 */
export function hazardKeyNotesJa(states: readonly HazardGroupState[]): readonly string[] {
  const shown = QUIET_STATES.filter((kind) => states.some((each) => each.state === kind))
  if (shown.length === 0) return []
  return [notSafeNoteJa(shown.map((kind) => GROUP_STATE_LABELS_JA[kind]))]
}
