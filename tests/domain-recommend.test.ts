/**
 * 「おすすめ駅」の合成（`src/domain/recommend/`）——**規範を 1 つずつ固定する**。
 *
 * `docs/260912_gui_chat_protocol.md` §13.4 の 6 項目に対応させてある。
 * 合成スコアは、内訳・除外の理由・揺らしたときの振る舞いが添わなければ読めない。
 * それらを「省ける」実装にしないことが、このテストの目的。
 *
 * ⚠ 規範 6（限界と出典を必ず末尾に）は**見せ方**の約束なので、ここでは扱わない。
 * 画面に出ていることは W4 の実レンダで見る。
 */

import { describe, expect, it } from 'vitest'
import { RECOMMEND_PRESETS, PRESET_IDS, recommendStations, weightSum } from '@/domain/recommend'
import type {
  CandidateStation,
  HazardPolicy,
  RecommendOptions,
  ScoredMetric,
} from '@/domain/recommend'
import type { HazardLevel } from '@/shared/constants'
import type { StationHazardSummary } from '@/shared/hazard-summary'

const PAX: ScoredMetric = { key: 'pax', direction: 'higher', weight: 0.5, reliabilityFlagKey: null }
const GROWTH: ScoredMetric = {
  key: 'pop_gr',
  direction: 'higher',
  weight: 0.5,
  reliabilityFlagKey: null,
}
const NO_HAZARD: HazardPolicy = { mode: 'off' }

function station(
  grp: string,
  values: Record<string, number>,
  level: HazardLevel | null = null,
): CandidateStation {
  const groups = {
    flood: { level: level ?? 'none', worstJa: null, nearby: false, uncovered: false },
    inland_flood: { level: 'none' as const, worstJa: null, nearby: false, uncovered: false },
    storm_surge: { level: 'none' as const, worstJa: null, nearby: false, uncovered: false },
    tsunami: { level: 'none' as const, worstJa: null, nearby: false, uncovered: false },
    landslide: { level: 'none' as const, worstJa: null, nearby: false, uncovered: false },
  }
  const hazard: StationHazardSummary | null =
    level === null
      ? null
      : {
          grp,
          level,
          evacuation: null,
          headlineJa: '（テスト）',
          certainty: 'exact',
          elevationM: 10,
          groups,
        }
  return { grp, name: grp, values, hazard }
}

function options(overrides: Partial<RecommendOptions> = {}): RecommendOptions {
  return { metrics: [PAX, GROWTH], method: 'percentile', hazard: NO_HAZARD, ...overrides }
}

function order(result: ReturnType<typeof recommendStations>): string[] {
  return result.ranked.map((entry) => entry.grp)
}

describe('規範 1：正規化してから合成する（方法は控えて返す）', () => {
  // 生の値を足すと、桁の大きい指標の言いなりになる。それが起きていないことを、
  // 「生の合計の順」と「正規化した順」が食い違うことで示す。
  const stations = [
    station('A', { pax: 200_000, pop_gr: 1 }),
    station('B', { pax: 199_000, pop_gr: 10 }),
    station('C', { pax: 198_000, pop_gr: 5 }),
  ]

  it('生の合計の順とは違う順になる（桁に引きずられていない）', () => {
    const rawOrder = [...stations]
      .sort(
        (a, b) =>
          (b.values.pax ?? 0) +
          (b.values.pop_gr ?? 0) -
          ((a.values.pax ?? 0) + (a.values.pop_gr ?? 0)),
      )
      .map((s) => s.grp)
    expect(rawOrder).toEqual(['A', 'B', 'C'])
    expect(order(recommendStations(stations, options()))).toEqual(['B', 'A', 'C'])
  })

  it('採った方法を結果に控える（本文に 1 行書けるように）', () => {
    for (const method of ['percentile', 'minmax', 'zscore'] as const) {
      expect(recommendStations(stations, options({ method })).method).toBe(method)
    }
  })

  it('差が付かなかった指標は degenerate として返す（黙って効かせない）', () => {
    const flat = [station('A', { pax: 10, pop_gr: 1 }), station('B', { pax: 10, pop_gr: 2 })]
    const result = recommendStations(flat, options())
    expect(result.degenerate).toEqual([{ key: 'pax', reason: 'no-spread' }])
  })
})

describe('規範 2：重みは利用者のもの（合計と向きを明示する）', () => {
  const stations = [station('A', { pax: 300, pop_gr: 10 }), station('B', { pax: 100, pop_gr: 30 })]

  it('重みは合計 1 に揃えて返す（脚注にそのまま出せる）', () => {
    const metrics = [
      { ...PAX, weight: 3 },
      { ...GROWTH, weight: 1 },
    ]
    const { weights } = recommendStations(stations, options({ metrics }))
    expect(weights.pax).toBeCloseTo(0.75, 10)
    expect(weights.pop_gr).toBeCloseTo(0.25, 10)
    expect(Object.values(weights).reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 10)
  })

  it('向きを変えると勝者が変わる（direction が効いている）', () => {
    const higher = recommendStations(stations, options({ metrics: [{ ...PAX, weight: 1 }] }))
    const lower = recommendStations(
      stations,
      options({ metrics: [{ ...PAX, weight: 1, direction: 'lower' }] }),
    )
    expect(order(higher)[0]).toBe('A')
    expect(order(lower)[0]).toBe('B')
  })

  it('重み 0 の指標は、欠損していても駅を落とさない', () => {
    // 画面でスライダを 0 にしただけで候補が消える、という事故を防ぐ。
    const metrics = [PAX, { ...GROWTH, weight: 0 }]
    const withoutGrowth = [station('A', { pax: 300 }), station('B', { pax: 100 })]
    const result = recommendStations(withoutGrowth, options({ metrics }))
    expect(result.excluded).toEqual([])
    expect(order(result)).toEqual(['A', 'B'])
  })

  it('プリセットは 4 つとも合計 1（スキルの表と同じ値）', () => {
    for (const id of PRESET_IDS) {
      expect(weightSum(RECOMMEND_PRESETS[id]), id).toBeCloseTo(1, 10)
    }
    // 予算重視だけ、地価水準を「安いほど良い」に向け直している。
    const budget = RECOMMEND_PRESETS.budget.metrics.find((m) => m.metric === 'lp_med')
    expect(budget?.direction).toBe('lower')
    expect(RECOMMEND_PRESETS.family.metrics.find((m) => m.metric === 'lp_med')?.weight).toBe(0)
  })
})

describe('規範 3：災害は線形加点しない（足切りは理由つきで返す）', () => {
  const stations = [
    station('A', { pax: 10, pop_gr: 1 }, 'none'),
    station('B', { pax: 20, pop_gr: 2 }, 'none'),
    station('C', { pax: 1000, pop_gr: 100 }, 'critical'),
  ]
  const policy: HazardPolicy = { mode: 'exclude', group: 'flood', atOrAbove: 'danger' }

  it('外した駅は、どのグループの何レベルで外したかを持つ', () => {
    const result = recommendStations(stations, options({ hazard: policy }))
    expect(order(result)).toEqual(['B', 'A'])
    expect(result.excluded).toEqual([
      { grp: 'C', name: 'C', reason: { kind: 'hazard', group: 'flood', level: 'critical' } },
    ])
  })

  it('外した駅は分布に残さない（候補の中での相対位置を見せているので）', () => {
    const result = recommendStations(stations, options({ hazard: policy }))
    const top = result.ranked[0]
    // A と B の 2 駅で正規化されるので、上位は 1、下位は 0 になる。
    // C（極端な値）が分布に残っていれば 0.5 になってしまう。
    expect(top?.breakdown.find((item) => item.key === 'pax')?.normalized).toBe(1)
  })

  it('段階減点は表の値をそのまま引く（掛け算をしない）', () => {
    const steps: Readonly<Record<HazardLevel, number>> = {
      none: 0,
      caution: 0,
      warning: 0,
      danger: 0,
      critical: 0.3,
    }
    const result = recommendStations(
      stations,
      options({ hazard: { mode: 'penalty', group: 'flood', steps } }),
    )
    const c = result.ranked.find((entry) => entry.grp === 'C')
    expect(c?.hazardPenalty).toBe(0.3)
    // 内訳の合計から、表の値ちょうどが引かれている。
    const sum = (c?.breakdown ?? []).reduce((total, item) => total + item.contribution, 0)
    expect(c?.score).toBeCloseTo(sum - 0.3, 10)
  })

  it('区域図が無い駅は落とさず、不明の印を付ける', () => {
    const unknown = [station('A', { pax: 10, pop_gr: 1 }), station('B', { pax: 20, pop_gr: 2 })]
    const result = recommendStations(unknown, options({ hazard: policy }))
    expect(result.excluded).toEqual([])
    expect(result.ranked.every((entry) => entry.hazardUncovered)).toBe(true)
  })
})

describe('規範 4：±20% の敏感度を必ず計算する', () => {
  it('指標数 × 2 回ぶん振る（乱数を使わない）', () => {
    const stations = [
      station('A', { pax: 300, pop_gr: 30 }),
      station('B', { pax: 200, pop_gr: 20 }),
    ]
    expect(recommendStations(stations, options()).sensitivity.runs).toBe(4)
  })

  it('全指標で勝っている駅がいれば頑健と言う', () => {
    const stations = [
      station('A', { pax: 300, pop_gr: 30 }),
      station('B', { pax: 200, pop_gr: 20 }),
      station('C', { pax: 100, pop_gr: 10 }),
    ]
    const { sensitivity } = recommendStations(stations, options())
    expect(sensitivity.stable).toBe(true)
    expect(sensitivity.swaps).toEqual([])
  })

  it('僅差なら入れ替わりを返す（頑健と言わない）', () => {
    const stations = [
      station('A', { pax: 100, pop_gr: 0 }),
      station('B', { pax: 0, pop_gr: 100 }),
      station('C', { pax: 50, pop_gr: 50 }),
    ]
    const metrics = [
      { ...PAX, weight: 0.51 },
      { ...GROWTH, weight: 0.49 },
    ]
    const { sensitivity } = recommendStations(stations, options({ metrics }))
    expect(sensitivity.stable).toBe(false)
    expect(sensitivity.swaps.length).toBeGreaterThan(0)
  })
})

describe('規範 5：欠損と ⚠ を黙って使わない', () => {
  const FLAGGED: ScoredMetric = { ...GROWTH, reliabilityFlagKey: 'pop_lowbase' }

  it('欠損した駅は、どの列が無くて外したのかを返す（0 で埋めない）', () => {
    const stations = [station('A', { pax: 10 }), station('B', { pax: 20, pop_gr: 2 })]
    const result = recommendStations(stations, options())
    expect(order(result)).toEqual(['B'])
    expect(result.excluded).toEqual([
      { grp: 'A', name: 'A', reason: { kind: 'missing', keys: ['pop_gr'] } },
    ])
  })

  it('既定（annotate）は残して印を付ける', () => {
    const stations = [
      station('A', { pax: 10, pop_gr: 1, pop_lowbase: 1 }),
      station('B', { pax: 20, pop_gr: 2 }),
    ]
    const result = recommendStations(stations, options({ metrics: [PAX, FLAGGED] }))
    expect(result.excluded).toEqual([])
    expect(result.flagged).toBe('annotate')
    const a = result.ranked.find((entry) => entry.grp === 'A')
    expect(a?.breakdown.find((item) => item.key === 'pop_gr')?.flagged).toBe(true)
  })

  it('exclude を選べば外し、どの列で外したのかを返す', () => {
    const stations = [
      station('A', { pax: 10, pop_gr: 1, pop_lowbase: 1 }),
      station('B', { pax: 20, pop_gr: 2 }),
    ]
    const result = recommendStations(
      stations,
      options({ metrics: [PAX, FLAGGED], flagged: 'exclude' }),
    )
    expect(order(result)).toEqual(['B'])
    expect(result.excluded).toEqual([
      { grp: 'A', name: 'A', reason: { kind: 'flagged', keys: ['pop_gr'] } },
    ])
  })
})

describe('純関数であること', () => {
  const stations = [station('A', { pax: 10, pop_gr: 1 }), station('B', { pax: 20, pop_gr: 2 })]

  it('同じ入力なら同じ出力（並びも含めて決定的）', () => {
    expect(recommendStations(stations, options())).toEqual(recommendStations(stations, options()))
  })

  it('入力を書き換えない', () => {
    const snapshot = JSON.stringify(stations)
    recommendStations(stations, options())
    expect(JSON.stringify(stations)).toBe(snapshot)
  })

  it('候補が 0 件でも落ちない', () => {
    const result = recommendStations([], options())
    expect(result.ranked).toEqual([])
    expect(result.sensitivity.stable).toBe(true)
  })
})
