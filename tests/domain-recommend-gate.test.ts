/**
 * 災害の扱い（`src/domain/recommend/hazard-gate.ts`）を固定する。
 * 規範 §13.4-3：**線形加点しない**・足切りなら件数と代表例・`uncovered` を安全と読ませない。
 *
 * ここは「間違えると人に危険を伝え損なう」場所なので、通す条件より
 * **落とさない条件**（区域図が無い・サマリが無い）を厚く見る。
 */

import { describe, expect, it } from 'vitest'
import { hazardGate } from '@/domain/recommend/hazard-gate'
import type { CandidateStation, HazardPolicy } from '@/domain/recommend/types'
import { HAZARD_LEVELS, type HazardLevel } from '@/shared/constants'
import type { HazardGroupSummary, StationHazardSummary } from '@/shared/hazard-summary'

function group(level: HazardLevel, extra: Partial<HazardGroupSummary> = {}): HazardGroupSummary {
  return { level, worstJa: null, nearby: false, uncovered: false, ...extra }
}

function summary(flood: HazardGroupSummary): StationHazardSummary {
  const none = group('none')
  return {
    grp: 'S#0',
    level: flood.level,
    evacuation: null,
    headlineJa: '（テスト）',
    certainty: 'exact',
    elevationM: 10,
    groups: {
      flood,
      inland_flood: none,
      storm_surge: none,
      tsunami: none,
      landslide: none,
    },
  }
}

function station(flood: HazardGroupSummary | null): CandidateStation {
  return {
    grp: 'S#0',
    name: 'テスト',
    values: {},
    hazard: flood === null ? null : summary(flood),
  }
}

const EXCLUDE_AT_DANGER: HazardPolicy = { mode: 'exclude', group: 'flood', atOrAbove: 'danger' }

describe('足切り（exclude）', () => {
  it('指定した高さ以上を外す', () => {
    for (const level of ['danger', 'critical'] as const) {
      const gate = hazardGate(station(group(level)), EXCLUDE_AT_DANGER)
      expect(gate.keep, level).toBe(false)
      expect(gate.excludedAt, level).toBe(level)
    }
  })

  it('指定より低い駅は残す', () => {
    for (const level of ['none', 'caution', 'warning'] as const) {
      const gate = hazardGate(station(group(level)), EXCLUDE_AT_DANGER)
      expect(gate.keep, level).toBe(true)
      expect(gate.excludedAt, level).toBeNull()
    }
  })

  it('区域図が無い駅（uncovered）は落とさず、不明の印を付ける', () => {
    // 「安全側に倒して除外」も「危険側に倒して通す」もしない。判定していないと言う。
    const gate = hazardGate(station(group('none', { uncovered: true })), EXCLUDE_AT_DANGER)
    expect(gate.keep).toBe(true)
    expect(gate.uncovered).toBe(true)
    expect(gate.excludedAt).toBeNull()
  })

  it('サマリが取れていない駅も不明として残す', () => {
    const gate = hazardGate(station(null), EXCLUDE_AT_DANGER)
    expect(gate.keep).toBe(true)
    expect(gate.uncovered).toBe(true)
  })

  it('区域外でもすぐ近くが区域なら、その印を運ぶ', () => {
    const gate = hazardGate(station(group('none', { nearby: true })), EXCLUDE_AT_DANGER)
    expect(gate.keep).toBe(true)
    expect(gate.nearby).toBe(true)
  })
})

describe('段階減点（penalty）', () => {
  const STEPS: Readonly<Record<HazardLevel, number>> = {
    none: 0,
    caution: 0.02,
    warning: 0.05,
    danger: 0.2,
    critical: 0.4,
  }
  const POLICY: HazardPolicy = { mode: 'penalty', group: 'flood', steps: STEPS }

  it('レベルごとの表を引くだけ（掛け算をしない）', () => {
    // 5 段すべてを回す（`HAZARD_LEVELS` を使うので、段が増えたらここも落ちる）。
    for (const level of HAZARD_LEVELS) {
      const gate = hazardGate(station(group(level)), POLICY)
      expect(gate.penalty, level).toBe(STEPS[level])
      expect(gate.keep, level).toBe(true)
    }
  })

  it('減点は等間隔にしなくてよい（順序尺度なので線形を仮定しない）', () => {
    // none→caution の差と danger→critical の差が違っても、表どおりに引ける。
    expect(STEPS.critical - STEPS.danger).not.toBeCloseTo(STEPS.caution - STEPS.none, 5)
    const worst = hazardGate(station(group('critical')), POLICY)
    expect(worst.penalty).toBe(STEPS.critical)
  })
})

describe('方針が off のとき', () => {
  it('何も見ない（減点も除外もしない）', () => {
    const gate = hazardGate(station(group('critical')), { mode: 'off' })
    expect(gate).toEqual({
      keep: true,
      penalty: 0,
      excludedAt: null,
      uncovered: false,
      nearby: false,
    })
  })
})
