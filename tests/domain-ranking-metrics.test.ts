import { describe, expect, it } from 'vitest'
import { getEntry, requireEntry } from '@/shared/catalog'
import { panelSchema } from '@/shared/protocol'
import { buildRanking, type RankRawRow } from '@/domain/ranking/presenter'
import { rankingPanel } from '@/domain/ranking/panel'
import {
  baseMetricLabel,
  DEFAULT_RANKING_KEY,
  DEFAULT_SCATTER_X,
  DEFAULT_SCATTER_Y,
  rankableGroups,
  variantLabel,
} from '@/domain/metrics'

const sampleRows: RankRawRow[] = [
  { grp: 'a', stationName: 'A', prefecture: '千葉県', value: 20, flagValue: 1, rank: 1 },
  { grp: 'b', stationName: 'B', prefecture: '千葉県', value: 10, flagValue: 0, rank: 2 },
]

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

  it('variantLabel：増減率＝年ペア・半径／level＝年・半径／推計＝ビンテージ', () => {
    expect(variantLabel(requireEntry('pop_gr_2020_2015_1km'))).toBe('2015→2020・1km')
    expect(variantLabel(requireEntry('pop_2020_1km'))).toBe('2020年・1km')
    expect(variantLabel(requireEntry('pop_pred_2024_2030_1km'))).toBe('R6推計・2030年・1km')
  })
})

describe('rankingPanel', () => {
  it('RankingResponse → rankingTable Panel（title に scope/方向・metricKey・行）', () => {
    const panel = rankingPanel(buildRanking('pop_gr_2020_2015_1km', '千葉県', 'desc', sampleRows))
    expect(panel.type).toBe('rankingTable')
    expect(panel.metricKey).toBe('pop_gr_2020_2015_1km')
    expect(panel.title).toContain('千葉県')
    expect(panel.title).toContain('上位')
    expect(panel.rows).toHaveLength(2)
    expect(panel.rows[0]?.flagged).toBe(true)
    expect(() => panelSchema.parse(panel)).not.toThrow()
  })

  it('全国・下位のタイトル', () => {
    const panel = rankingPanel(buildRanking('pop_2020_1km', null, 'asc', sampleRows))
    expect(panel.title).toContain('全国')
    expect(panel.title).toContain('下位')
  })
})
