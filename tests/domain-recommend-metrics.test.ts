/**
 * 指標の解決（`src/domain/recommend/metrics.ts`）を固定する。
 *
 * ここが狂うと、**別の年・別の半径で計算した順位を、同じ順位だと思って比べる**ことになる。
 * 埋めた既定を `notes` で返すこと、解決できなかった指定を黙って落とさないことを見る。
 */

import { describe, expect, it } from 'vitest'
import { columnsFor, resolveMetrics } from '@/domain/recommend/metrics'
import { RECOMMEND_PRESETS } from '@/domain/recommend/presets'
import type { PresetMetric } from '@/domain/recommend/presets'
import { getEntry } from '@/shared/catalog'

const RADIUS_M = 1000

function spec(metric: string, overrides: Partial<PresetMetric> = {}): PresetMetric {
  return { metric, labelJa: metric, direction: 'higher', weight: 1, ...overrides }
}

describe('正確な key を渡したとき', () => {
  it('そのまま使い、既定を埋めた記録は残さない', () => {
    const { metrics, notes, unresolved } = resolveMetrics([spec('rate_covid')], RADIUS_M)
    expect(metrics[0]?.key).toBe('rate_covid')
    expect(notes).toEqual([])
    expect(unresolved).toEqual([])
  })

  it('信頼性フラグはカタログから取る（プリセットには書かせない）', () => {
    const { metrics } = resolveMetrics([spec('rate_covid')], RADIUS_M)
    expect(metrics[0]?.reliabilityFlagKey).toBe(getEntry('rate_covid')?.reliabilityFlagKey)
    expect(metrics[0]?.reliabilityFlagKey).toBe('flag_covid_lown')
  })

  it('向きと重みはプリセットの指定をそのまま運ぶ（カタログから取らない）', () => {
    const { metrics } = resolveMetrics(
      [spec('lp_med_2026_1km', { direction: 'lower', weight: 0.15 })],
      RADIUS_M,
    )
    expect(metrics[0]?.direction).toBe('lower')
    expect(metrics[0]?.weight).toBe(0.15)
  })
})

describe('ファミリ名を渡したとき', () => {
  it('その半径の最新年を選び、選んだことを notes に残す', () => {
    const { metrics, notes } = resolveMetrics([spec('lp_med')], RADIUS_M)
    const entry = getEntry(metrics[0]?.key ?? '')
    expect(entry?.baseMetric).toBe('lp_med')
    expect(entry?.radiusM).toBe(RADIUS_M)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain(metrics[0]?.key ?? '')
  })

  it('半径を変えると別の key になる', () => {
    const near = resolveMetrics([spec('lp_med')], 500).metrics[0]?.key
    const far = resolveMetrics([spec('lp_med')], 2000).metrics[0]?.key
    expect(near).not.toBe(far)
    expect(getEntry(near ?? '')?.radiusM).toBe(500)
    expect(getEntry(far ?? '')?.radiusM).toBe(2000)
  })

  it('半径を持たない指標は、どの半径でも同じ key になる', () => {
    // 乗降客数は駅の値で、半径に依らない。
    const a = resolveMetrics([spec('pax')], 500).metrics[0]?.key
    const b = resolveMetrics([spec('pax')], 20_000).metrics[0]?.key
    expect(a).toBe(b)
    expect(getEntry(a ?? '')?.radiusM).toBeNull()
  })

  it('フラグ列そのものは選ばない（指標として使えないので）', () => {
    const { metrics } = resolveMetrics([spec('lp_med')], RADIUS_M)
    expect(getEntry(metrics[0]?.key ?? '')?.kind).not.toBe('flag')
  })
})

describe('解決できないとき', () => {
  it('黙って減らさず、unresolved に積む', () => {
    const { metrics, unresolved } = resolveMetrics([spec('pax'), spec('存在しない指標')], RADIUS_M)
    expect(metrics).toHaveLength(1)
    expect(unresolved).toEqual(['存在しない指標'])
  })
})

describe('値を引く列', () => {
  it('指標と信頼性フラグの両方を含み、重複は畳む', () => {
    const { metrics } = resolveMetrics([spec('lp_med'), spec('lp_gr')], RADIUS_M)
    const columns = columnsFor(metrics)
    for (const metric of metrics) {
      expect(columns).toContain(metric.key)
      if (metric.reliabilityFlagKey !== null) expect(columns).toContain(metric.reliabilityFlagKey)
    }
    expect(new Set(columns).size).toBe(columns.length)
  })

  it('フラグを持たない指標は列を増やさない', () => {
    const { metrics } = resolveMetrics([spec('pax')], RADIUS_M)
    expect(metrics[0]?.reliabilityFlagKey).toBeNull()
    expect(columnsFor(metrics)).toEqual([metrics[0]?.key])
  })
})

describe('プリセットは 4 つとも解決できる', () => {
  it('どのプリセットも、全指標がカタログに実在する', () => {
    for (const preset of Object.values(RECOMMEND_PRESETS)) {
      const { metrics, unresolved } = resolveMetrics(preset.metrics, RADIUS_M)
      expect(unresolved, preset.id).toEqual([])
      expect(metrics, preset.id).toHaveLength(preset.metrics.length)
      // 向きの指定は失われない（予算重視の地価水準は「安いほど良い」のまま）。
      const landPrice = metrics.find((metric) => metric.key.startsWith('lp_med'))
      const source = preset.metrics.find((spec) => spec.metric === 'lp_med')
      expect(landPrice?.direction, preset.id).toBe(source?.direction)
    }
  })
})
