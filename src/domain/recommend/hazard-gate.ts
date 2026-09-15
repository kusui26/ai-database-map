/**
 * ドメイン：**災害の扱い**（純関数・`docs/260912_gui_chat_protocol.md` §13.4-3）。
 *
 * 危険度は**順序尺度**（none < caution < warning < danger < critical）なので、
 * 数値として重みを掛けて足すことはしない。できるのは 2 つだけ。
 *
 * - **足切り**：指定の高さ以上を候補から外す。**外した駅数と代表例を必ず出す**
 * - **段階減点**：レベルごとの減点を**表で明示**する。`level × 係数` のような掛け算はしない
 *
 * ## `uncovered` を「安全」と読ませない
 *
 * `uncovered=true` は「この地域に区域図が無い」であって、危険が無いという意味ではない。
 * だから**足切りの対象にもしないし、通過したとも数えない**——不明として印だけ付けて残す。
 * 安全側に倒して除外すると、区域図が未整備なだけの駅が候補から静かに消える。
 * 危険側に倒して通すと、「足切りを通った＝大丈夫」と読まれる。どちらも避ける。
 */

import { type HazardLevel, hazardLevelWeight } from '@/shared/constants'
import type { StationHazardSummary, SummaryHazardGroup } from '@/shared/hazard-summary'
import type { CandidateStation, HazardPolicy } from './types'

export type GateOutcome = {
  /** 候補に残すか。 */
  readonly keep: boolean
  /** 段階減点（`penalty` のときだけ非 0）。 */
  readonly penalty: number
  /** 足切りに掛かったときの、掛かった理由。 */
  readonly excludedAt: HazardLevel | null
  /** 区域図が無いグループがある＝不明。 */
  readonly uncovered: boolean
  /** 区域外だが、すぐ近くが区域。 */
  readonly nearby: boolean
}

const PASS: GateOutcome = {
  keep: true,
  penalty: 0,
  excludedAt: null,
  uncovered: false,
  nearby: false,
}

/** サマリが無い駅は「不明」。落とさずに印だけ付ける。 */
const UNKNOWN: GateOutcome = { ...PASS, uncovered: true }

function groupOf(
  summary: StationHazardSummary,
  group: SummaryHazardGroup,
): StationHazardSummary['groups'][SummaryHazardGroup] {
  return summary.groups[group]
}

/** 足切り：`atOrAbove` 以上なら外す。ただし区域図が無い駅は判定しない。 */
function applyExclude(
  summary: StationHazardSummary,
  group: SummaryHazardGroup,
  atOrAbove: HazardLevel,
): GateOutcome {
  const entry = groupOf(summary, group)
  const base = { penalty: 0, uncovered: entry.uncovered, nearby: entry.nearby }
  if (entry.uncovered) return { ...base, keep: true, excludedAt: null }
  const over = hazardLevelWeight(entry.level) >= hazardLevelWeight(atOrAbove)
  return over
    ? { ...base, keep: false, excludedAt: entry.level }
    : { ...base, keep: true, excludedAt: null }
}

/** 段階減点：レベル → 減点の表を引くだけ（掛け算をしない）。 */
function applyPenalty(
  summary: StationHazardSummary,
  group: SummaryHazardGroup,
  steps: Readonly<Record<HazardLevel, number>>,
): GateOutcome {
  const entry = groupOf(summary, group)
  return {
    keep: true,
    penalty: steps[entry.level],
    excludedAt: null,
    uncovered: entry.uncovered,
    nearby: entry.nearby,
  }
}

/** 1 駅ぶんの判定。方針が `off` なら何もしない。 */
export function hazardGate(station: CandidateStation, policy: HazardPolicy): GateOutcome {
  if (policy.mode === 'off') return PASS
  if (station.hazard === null) return UNKNOWN
  return policy.mode === 'exclude'
    ? applyExclude(station.hazard, policy.group, policy.atOrAbove)
    : applyPenalty(station.hazard, policy.group, policy.steps)
}
