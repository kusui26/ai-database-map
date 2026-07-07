import { describe, expect, it } from 'vitest'
import { kmeans, type Point2D } from '@/domain/growth/kmeans'
import { buildGrowth, type ValueRow } from '@/domain/growth/presenter'

/** 決定的なブロブ（乱数なし）。 */
const blob = (cx: number, cy: number, n: number): Point2D[] =>
  Array.from({ length: n }, (_, i) => ({ x: cx + (i % 3) * 0.1, y: cy + (i % 2) * 0.1 }))

describe('kmeans（決定的）', () => {
  it('同一入力・同一シードで同一割当', () => {
    const points = [...blob(0, 0, 12), ...blob(100, 100, 12)]
    expect(kmeans(points, 2)).toEqual(kmeans(points, 2))
  })

  it('分離した2ブロブを2クラスタに分ける', () => {
    const points = [...blob(0, 0, 12), ...blob(100, 100, 12)]
    const assign = kmeans(points, 2)
    const front = assign.slice(0, 12)
    const back = assign.slice(12)
    expect(new Set(front).size).toBe(1)
    expect(new Set(back).size).toBe(1)
    expect(front[0]).not.toBe(back[0])
  })

  it('n <= k は各点を別クラスタに', () => {
    expect(
      kmeans(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        4,
      ),
    ).toEqual([0, 1])
  })

  it('空入力は空', () => {
    expect(kmeans([], 4)).toEqual([])
  })

  it('定数次元でも 0 除算せず動く', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ x: 5, y: i }))
    expect(kmeans(points, 2)).toHaveLength(10)
  })
})

describe('buildGrowth', () => {
  const rows: ValueRow[] = [
    { grp: 'a', stationName: 'A', key: 'pop_gr_2020_2015_1km', value: 5 },
    { grp: 'a', stationName: 'A', key: 'rate_covid', value: -3 },
    { grp: 'b', stationName: 'B', key: 'pop_gr_2020_2015_1km', value: 50 },
    { grp: 'b', stationName: 'B', key: 'rate_covid', value: -30 },
  ]

  it('grp で pivot して (x,y) 点・メタ情報', () => {
    const g = buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid')
    expect(g.points).toHaveLength(2)
    expect(g.x.key).toBe('pop_gr_2020_2015_1km')
    expect(g.y.labelJa).toContain('コロナ')
    expect(g.points.every((p) => typeof p.cluster === 'number')).toBe(true)
  })

  it('x か y が欠ける駅は除外', () => {
    const partial: ValueRow[] = [
      { grp: 'c', stationName: 'C', key: 'pop_gr_2020_2015_1km', value: 1 },
    ]
    expect(
      buildGrowth([...rows, ...partial], 'pop_gr_2020_2015_1km', 'rate_covid').points,
    ).toHaveLength(2)
  })

  it('excludeLowN で lown フラグの立つ駅を除外', () => {
    const withFlags: ValueRow[] = [
      ...rows,
      { grp: 'a', stationName: 'A', key: 'pop_lowbase_2015_1km', value: 1 }, // a はフラグ立ち
      { grp: 'b', stationName: 'B', key: 'pop_lowbase_2015_1km', value: 0 },
    ]
    const g = buildGrowth(withFlags, 'pop_gr_2020_2015_1km', 'rate_covid', { excludeLowN: true })
    expect(g.points).toHaveLength(1)
    expect(g.excludedLowN).toBe(1)
    expect(g.points[0]?.grp).toBe('b')
  })
})
