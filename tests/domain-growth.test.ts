import { describe, expect, it } from 'vitest'
import { panelSchema } from '@/shared/protocol'
import { kmeans, type Point2D } from '@/domain/growth/kmeans'
import { buildGrowth, type ScatterRow } from '@/domain/growth/presenter'
import { scatterPanel } from '@/domain/growth/panel'

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

/**
 * クラスタ番号は 0..m-1 の連番（欠番なし）でなければならない。
 * 欠番があると描画側で最大番号の点が無言で落ちる
 * （docs/260728_fix_scatter_chart_sparse_cluster_labels.md）。
 */
describe('kmeans：クラスタ番号の連番不変条件', () => {
  const isContiguous = (labels: readonly number[]): boolean =>
    labels.length === 0 || new Set(labels).size === Math.max(...labels) + 1

  it('回帰：空クラスタが生じる既知の入力でも欠番を作らない', () => {
    // 修正前は [0,0,2,2,0,3,2]（1 が欠番）を返し、描画時に 7 点中 1 点が落ちていた。
    const points = [2, 2, 8, 7, 1, 0, 12].map((x) => ({ x, y: 0 }))
    const labels = kmeans(points)
    expect(isContiguous(labels)).toBe(true)
    expect(new Set(labels).size).toBe(3)
    // 同じ集団分けが保たれる（詰めても分割そのものは不変）。
    expect(labels[0]).toBe(labels[1])
    expect(labels[2]).toBe(labels[3])
    expect(labels[5]).not.toBe(labels[0])
  })

  it('ランダム探索（離散値・小標本を厚く）でも常に連番', () => {
    const prng = (seed: number) => {
      let state = seed >>> 0
      return () => {
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    for (let trial = 0; trial < 4000; trial += 1) {
      const rand = prng(trial * 2654435761 + 17)
      const n = 5 + Math.floor(rand() * 15)
      const points = Array.from({ length: n }, () => ({ x: Math.floor(rand() * 13), y: 0 }))
      expect(isContiguous(kmeans(points))).toBe(true)
    }
  })

  it('境界：空・1 点・n<=k・全点同一値でも連番', () => {
    expect(isContiguous(kmeans([]))).toBe(true)
    expect(kmeans([{ x: 1, y: 1 }])).toEqual([0])
    expect(
      isContiguous(
        kmeans([
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ]),
      ),
    ).toBe(true)
    expect(kmeans(Array.from({ length: 8 }, () => ({ x: 7, y: 7 })))).toEqual(
      Array.from({ length: 8 }, () => 0),
    )
  })
})

describe('buildGrowth', () => {
  // DB（scatter_points）が駅 1 行に畳んで返す形。x/y が欠ける駅は DB 側で除かれている。
  const rows: ScatterRow[] = [
    { grp: 'a', stationName: 'A', x: 5, y: -3, xFlag: null, yFlag: null },
    { grp: 'b', stationName: 'B', x: 50, y: -30, xFlag: null, yFlag: null },
  ]

  it('grp で pivot して (x,y) 点・メタ情報', () => {
    const g = buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid')
    expect(g.points).toHaveLength(2)
    expect(g.x.key).toBe('pop_gr_2020_2015_1km')
    expect(g.y.labelJa).toContain('コロナ')
    expect(g.points.every((p) => typeof p.cluster === 'number')).toBe(true)
  })

  // 260804：x か y が欠ける駅は DB（scatter_points）が返さないので、ここには届かない。
  // 代わりに「フラグが無い／値が無い」ときに落とさないことを守る。
  it('フラグが null（指標にフラグが無い・値が無い）の駅は除外しない', () => {
    const g = buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', { excludeLowN: true })
    expect(g.points).toHaveLength(2)
    expect(g.excludedLowN).toBe(0)
  })

  it('excludeLowN を指定しなければフラグが立っていても残す', () => {
    const flagged: ScatterRow[] = [{ grp: 'a', stationName: 'A', x: 1, y: 2, xFlag: 1, yFlag: 1 }]
    expect(buildGrowth(flagged, 'pop_gr_2020_2015_1km', 'rate_covid').points).toHaveLength(1)
  })

  it('excludeLowN で lown フラグの立つ駅を除外', () => {
    const withFlags: ScatterRow[] = [
      { grp: 'a', stationName: 'A', x: 5, y: -3, xFlag: 1, yFlag: null }, // a はフラグ立ち
      { grp: 'b', stationName: 'B', x: 50, y: -30, xFlag: 0, yFlag: null },
    ]
    const g = buildGrowth(withFlags, 'pop_gr_2020_2015_1km', 'rate_covid', { excludeLowN: true })
    expect(g.points).toHaveLength(1)
    expect(g.excludedLowN).toBe(1)
    expect(g.points[0]?.grp).toBe('b')
  })

  it('乗降コロナ前後の除外は低分母フラグだけを見る（被覆の大駅を落とさない・260731）', () => {
    // 新横浜は flag_covid=1（被覆 3/5）だが低分母ではない → 残す。
    // 御厨は |率|>100% の小駅 → 落とす。
    const covid: ScatterRow[] = [
      { grp: '新横浜#0', stationName: '新横浜', x: 4.1, y: -22.8, xFlag: 0, yFlag: 0 },
      { grp: '御厨#1', stationName: '御厨', x: 1, y: 4777.9, xFlag: 0, yFlag: 1 },
    ]
    const g = buildGrowth(covid, 'pop_gr_2020_2015_2km', 'rate_covid', { excludeLowN: true })
    expect(g.points.map((p) => p.grp)).toEqual(['新横浜#0'])
    expect(g.excludedLowN).toBe(1)
  })

  it('scatterPanel：GrowthResponse → scatter Panel（title/軸/点/クラスタ）', () => {
    const panel = scatterPanel(
      buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', { prefectures: ['千葉県'] }),
    )
    expect(panel.type).toBe('scatter')
    expect(panel.title).toContain('千葉県')
    expect(panel.xLabel).toContain('人口増減率')
    expect(panel.points).toHaveLength(2)
    expect(panel.clusterCount).toBeGreaterThanOrEqual(1)
    expect(() => panelSchema.parse(panel)).not.toThrow()
  })

  it('scatterPanel：全国のタイトル', () => {
    expect(scatterPanel(buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid')).title).toContain(
      '全国',
    )
  })

  it('scatterPanel：運営会社で絞ったらタイトルに併記する（260730）', () => {
    const panel = scatterPanel(
      buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', {
        prefectures: ['千葉県'],
        operators: ['東日本旅客鉄道'],
      }),
    )
    expect(panel.title).toContain('千葉県・東日本旅客鉄道')
    expect(() => panelSchema.parse(panel)).not.toThrow()
  })

  it('scatterPanel：運営会社を絞らないときは従来どおり都道府県だけ', () => {
    const panel = scatterPanel(
      buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', { prefectures: ['千葉県'] }),
    )
    expect(panel.title).toContain('（千葉県）')
  })

  it('scatterPanel：路線・種別で絞ったらタイトルに併記する（260731）', () => {
    const byRoute = scatterPanel(
      buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', {
        operators: ['東海旅客鉄道'],
        routes: ['東海道新幹線'],
      }),
    )
    expect(byRoute.title).toContain('全国・東海旅客鉄道・東海道新幹線')

    const byType = scatterPanel(
      buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', {
        operators: ['東海旅客鉄道'],
        routeTypes: [1],
      }),
    )
    expect(byType.title).toContain('東海旅客鉄道・新幹線')
    expect(() => panelSchema.parse(byType)).not.toThrow()
  })

  it('buildGrowth：routes / routeTypes も応答に載る（絞り込み自体は DB 側）', () => {
    const response = buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', {
      routes: ['東海道線'],
      routeTypes: [1, 2],
    })
    expect(response.routes).toEqual(['東海道線'])
    expect(response.routeTypes).toEqual([1, 2])
    const bare = buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid')
    expect(bare.routes).toEqual([])
    expect(bare.routeTypes).toEqual([])
    expect(scatterPanel(bare).title).toContain('（全国）') // 絞っていなければ従来どおり
  })

  it('buildGrowth：operators は応答にそのまま載る（絞り込み自体は DB 側）', () => {
    const response = buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid', {
      operators: ['東武鉄道', '西武鉄道'],
    })
    expect(response.operators).toEqual(['東武鉄道', '西武鉄道'])
    expect(buildGrowth(rows, 'pop_gr_2020_2015_1km', 'rate_covid').operators).toEqual([])
  })

  it('clusterCount は常に max(cluster)+1（描画側の前提と一致する）', () => {
    const many: ScatterRow[] = [2, 2, 8, 7, 1, 0, 12].map((x, i) => ({
      grp: `s${i}`,
      stationName: `駅${i}`,
      x,
      y: 0,
      xFlag: null,
      yFlag: null,
    }))
    for (const input of [rows, many]) {
      const g = buildGrowth(input, 'pop_gr_2020_2015_1km', 'rate_covid')
      const clusters = g.points.map((p) => p.cluster)
      expect(g.clusterCount).toBe(Math.max(...clusters) + 1)
      expect(new Set(clusters).size).toBe(g.clusterCount)
    }
  })

  it('境界：点が 0 件でも clusterCount は 0 で破綻しない', () => {
    const g = buildGrowth([], 'pop_gr_2020_2015_1km', 'rate_covid')
    expect(g.points).toHaveLength(0)
    expect(g.clusterCount).toBe(0)
  })
})
