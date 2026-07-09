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
  radiiOf,
  rankableGroups,
  rankableVariantGroups,
  variantLabel,
  variantTokenOf,
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

  it('増減率は符号付き整形・フラグ解決・ラベル・複数県／total／offset', () => {
    const r = buildRanking('pop_gr_2020_2015_1km', ['東京都', '千葉県'], 'desc', rows, 500, 50)
    expect(r.rows[0]?.formatted).toBe('+20.0%')
    expect(r.rows[0]?.flagged).toBe(true)
    expect(r.rows[1]?.flagged).toBe(false)
    expect(r.metric.labelJa).toContain('人口増減率')
    expect(r.prefectures).toEqual(['東京都', '千葉県'])
    expect(r.total).toBe(500)
    expect(r.offset).toBe(50)
  })

  it('level 指標は符号なし整形・全国（空配列）', () => {
    const r = buildRanking(
      'pop_2020_1km',
      [],
      'desc',
      [{ grp: 'a', stationName: 'A', prefecture: '東京都', value: 91013, flagValue: null, rank: 1 }],
      1,
      0,
    )
    expect(r.rows[0]?.formatted).toBe('91,013')
    expect(r.prefectures).toEqual([])
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

  it('variantLabel（P6c）：半径を含まない（年ペア／年／推計）', () => {
    expect(variantLabel(requireEntry('pop_gr_2020_2015_1km'))).toBe('2015→2020')
    expect(variantLabel(requireEntry('pop_2020_1km'))).toBe('2020年')
    expect(variantLabel(requireEntry('pop_pred_2024_2030_1km'))).toBe('R6推計・2030年')
  })

  it('variantTokenOf：同一変種の別半径は同トークン・別期間は別トークン', () => {
    expect(variantTokenOf('pop_gr_2020_2015_1km')).toBe(variantTokenOf('pop_gr_2020_2015_2km'))
    expect(variantTokenOf('pop_gr_2020_2015_1km')).not.toBe(variantTokenOf('pop_gr_2020_2010_1km'))
  })

  it('rankableVariantGroups：変種は半径で束ねられ byRadius で key 解決', () => {
    const groups = rankableVariantGroups('population')
    const popGr = groups.find((g) => g.baseMetric === 'pop_gr')
    const variant = popGr?.variants.find((v) => v.labelJa === '2015→2020')
    expect(variant).toBeDefined()
    if (variant !== undefined) {
      expect(radiiOf(variant)).toEqual([500, 1000, 2000, 5000, 10000, 20000])
      expect(variant.byRadius.get(1000)).toBe('pop_gr_2020_2015_1km')
    }
  })

  it('lp_gr の変種は利用可能半径のみ（500m/20km なし）', () => {
    const groups = rankableVariantGroups('land_price')
    const variant = groups.find((g) => g.baseMetric === 'lp_gr')?.variants[0]
    expect(variant).toBeDefined()
    if (variant !== undefined) expect(radiiOf(variant)).toEqual([1000, 2000, 5000, 10000])
  })
})

describe('rankingPanel', () => {
  it('RankingResponse → rankingTable Panel（title に scope/方向・metricKey・行）', () => {
    const panel = rankingPanel(
      buildRanking('pop_gr_2020_2015_1km', ['千葉県'], 'desc', sampleRows, 2, 0),
    )
    expect(panel.type).toBe('rankingTable')
    expect(panel.metricKey).toBe('pop_gr_2020_2015_1km')
    expect(panel.title).toContain('千葉県')
    expect(panel.title).toContain('上位')
    expect(panel.rows).toHaveLength(2)
    expect(panel.rows[0]?.flagged).toBe(true)
    expect(() => panelSchema.parse(panel)).not.toThrow()
  })

  it('全国（空配列）・下位のタイトル', () => {
    const panel = rankingPanel(buildRanking('pop_2020_1km', [], 'asc', sampleRows, 2, 0))
    expect(panel.title).toContain('全国')
    expect(panel.title).toContain('下位')
  })
})
