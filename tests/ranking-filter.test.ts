import { describe, expect, it } from 'vitest'
import { panelSchema } from '@/shared/protocol'
import { scopeLabel } from '@/domain/scope'
import { buildRanking, type RankRawRow } from '@/domain/ranking/presenter'
import { rankingPanel } from '@/domain/ranking/panel'
import { type RankingQuery, rankingUrl } from '@/components/ranking/useRanking'

const rows: RankRawRow[] = [
  {
    grp: '東京#0',
    stationName: '東京',
    prefecture: '東京都',
    value: 18.4,
    flagValue: 0,
    rank: 1,
  },
]

describe('scopeLabel（散布とランキングで共有・260801）', () => {
  const empty = { prefectures: [], operators: [], routes: [], routeTypes: [] }

  it('絞っていなければ「全国」だけ', () => {
    expect(scopeLabel(empty)).toBe('全国')
  })

  it('絞ったものだけを都道府県 → 会社 → 路線 → 種別の順に併記', () => {
    expect(
      scopeLabel({
        ...empty,
        prefectures: ['静岡県'],
        operators: ['東海旅客鉄道'],
        routes: ['東海道新幹線'],
        routeTypes: [1],
      }),
    ).toBe('静岡県・東海旅客鉄道・東海道新幹線・新幹線')
    expect(scopeLabel({ ...empty, routeTypes: [1] })).toBe('全国・新幹線')
    expect(scopeLabel({ ...empty, operators: ['東武鉄道', '西武鉄道'] })).toBe(
      '全国・東武鉄道・西武鉄道',
    )
  })
})

describe('buildRanking / rankingPanel（絞り込みの反映・260801）', () => {
  it('絞り込みが応答にそのまま載る（絞り込み自体は DB 側）', () => {
    const response = buildRanking('pop_gr_2020_2015_1km', ['静岡県'], 'desc', rows, 6, 0, {
      operators: ['東海旅客鉄道'],
      routeTypes: [1],
    })
    expect(response.operators).toEqual(['東海旅客鉄道'])
    expect(response.routeTypes).toEqual([1])
    expect(response.routes).toEqual([])
    expect(response.total).toBe(6)
  })

  it('絞り込まなければ従来どおり空配列', () => {
    const bare = buildRanking('pop_gr_2020_2015_1km', [], 'desc', rows, 9234, 0)
    expect(bare.operators).toEqual([])
    expect(bare.routes).toEqual([])
    expect(bare.routeTypes).toEqual([])
  })

  it('パネルのタイトルに絞り込みと並び順が出る', () => {
    const panel = rankingPanel(
      buildRanking('pop_gr_2020_2015_1km', [], 'desc', rows, 17, 0, {
        operators: ['東海旅客鉄道'],
        routeTypes: [1],
      }),
    )
    expect(panel.title).toContain('全国・東海旅客鉄道・新幹線・上位')
    expect(() => panelSchema.parse(panel)).not.toThrow()
  })

  it('絞り込みなしのタイトルは従来と同じ（非回帰）', () => {
    const panel = rankingPanel(buildRanking('pop_gr_2020_2015_1km', ['千葉県'], 'asc', rows, 3, 0))
    expect(panel.title).toContain('（千葉県・下位）')
  })
})

/**
 * SWR Infinite のキー＝リクエスト URL。絞っていない軸を載せないことがキャッシュ命中の条件で、
 * offset がページごとに変わることがページングの前提。
 */
describe('rankingUrl（ランキングの SWR キー）', () => {
  const base: RankingQuery = {
    metric: 'pax_2024',
    prefectures: [],
    operators: [],
    routes: [],
    routeTypes: [],
    order: 'desc',
    excludeLowN: false,
  }

  it('絞っていない軸はクエリに現れない', () => {
    expect(rankingUrl(base, 0)).toBe('/api/ranking?metric=pax_2024&order=desc&limit=50&offset=0')
  })

  it('ページ番号が offset になる', () => {
    expect(rankingUrl(base, 2)).toContain('offset=100')
  })

  it('絞り込みと除外フラグが載る（依頼のユースケース）', () => {
    const url = new URL(
      rankingUrl(
        {
          ...base,
          prefectures: ['静岡県'],
          operators: ['東海旅客鉄道'],
          routes: ['東海道新幹線'],
          routeTypes: [1, 2],
          excludeLowN: true,
        },
        0,
      ),
      'https://example.test',
    )
    expect(url.searchParams.get('prefecture')).toBe('静岡県')
    expect(url.searchParams.get('operators')).toBe('東海旅客鉄道')
    expect(url.searchParams.get('routes')).toBe('東海道新幹線')
    expect(url.searchParams.get('routeTypes')).toBe('1,2')
    expect(url.searchParams.get('excludeLowN')).toBe('true')
  })
})
