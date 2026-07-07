import { describe, expect, it } from 'vitest'
import { getEntry } from '@/shared/catalog'
import { buildRanking, type RankRawRow } from '@/domain/ranking/presenter'
import {
  baseMetricLabel,
  DEFAULT_RANKING_KEY,
  DEFAULT_SCATTER_X,
  DEFAULT_SCATTER_Y,
  rankableGroups,
} from '@/domain/metrics'

describe('buildRanking', () => {
  const rows: RankRawRow[] = [
    { grp: 'a', stationName: 'A', prefecture: '東京都', value: 20, flagValue: 1, rank: 1 },
    { grp: 'b', stationName: 'B', prefecture: '東京都', value: 10, flagValue: 0, rank: 2 },
  ]

  it('増減率は符号付き整形・フラグ解決・ラベル', () => {
    const r = buildRanking('pop_gr_2020_2015_1km', '東京都', 'desc', rows)
    expect(r.rows[0]?.formatted).toBe('+20.0%')
    expect(r.rows[0]?.flagged).toBe(true)
    expect(r.rows[1]?.flagged).toBe(false)
    expect(r.metric.labelJa).toContain('人口増減率')
    expect(r.prefecture).toBe('東京都')
  })

  it('level 指標は符号なし整形', () => {
    const r = buildRanking('pop_2020_1km', null, 'desc', [
      { grp: 'a', stationName: 'A', prefecture: '東京都', value: 91013, flagValue: null, rank: 1 },
    ])
    expect(r.rows[0]?.formatted).toBe('91,013')
  })
})

describe('domain/metrics', () => {
  it('baseMetricLabel', () => {
    expect(baseMetricLabel('pop_gr')).toBe('人口増減率')
    expect(baseMetricLabel('__unknown__')).toBe('__unknown__')
  })

  it('rankableGroups(population) は baseMetric でまとまり全て rankable', () => {
    const groups = rankableGroups('population')
    expect(groups.some((g) => g.baseMetric === 'pop')).toBe(true)
    expect(groups.every((g) => g.entries.every((e) => e.rankable))).toBe(true)
  })

  it('既定指標が catalog に存在し rankable', () => {
    for (const key of [DEFAULT_RANKING_KEY, DEFAULT_SCATTER_X, DEFAULT_SCATTER_Y]) {
      expect(getEntry(key)?.rankable).toBe(true)
    }
  })
})
