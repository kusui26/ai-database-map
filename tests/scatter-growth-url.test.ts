import { describe, expect, it } from 'vitest'
import { type GrowthQuery, growthUrl } from '@/components/scatter/useGrowth'

const BASE: GrowthQuery = {
  x: 'pop_gr_2020_2015_1km',
  y: 'rate_covid',
  prefectures: [],
  operators: [],
  routes: [],
  routeTypes: [],
  excludeLowN: false,
}

/**
 * SWR キー＝リクエスト URL。絞っていない軸を載せないことがキャッシュ命中の条件で、
 * 余計なパラメータが混ざると同じ条件でも取得し直しになる。
 */
describe('growthUrl（散布の SWR キー）', () => {
  it('絞っていない軸はクエリに現れない', () => {
    expect(growthUrl(BASE)).toBe('/api/growth?x=pop_gr_2020_2015_1km&y=rate_covid')
  })

  it('路線・種別はカンマ区切りで載る（依頼のユースケース）', () => {
    const url = growthUrl({ ...BASE, operators: ['東海旅客鉄道'], routeTypes: [1] })
    expect(url).toContain('operators=%E6%9D%B1%E6%B5%B7%E6%97%85%E5%AE%A2%E9%89%84%E9%81%93')
    expect(url).toContain('routeTypes=1')
    expect(url).not.toContain('routes=')
  })

  it('複数指定・除外フラグ・都道府県が同時に載る', () => {
    const url = new URL(
      growthUrl({
        ...BASE,
        prefectures: ['静岡県'],
        routes: ['東海道新幹線', '東海道線'],
        routeTypes: [1, 2],
        excludeLowN: true,
      }),
      'https://example.test',
    )
    expect(url.searchParams.get('prefecture')).toBe('静岡県')
    expect(url.searchParams.get('routes')).toBe('東海道新幹線,東海道線')
    expect(url.searchParams.get('routeTypes')).toBe('1,2')
    expect(url.searchParams.get('excludeLowN')).toBe('true')
  })
})
