import { describe, expect, it } from 'vitest'
import { groupPointsByCluster } from '@/components/panels/scatterDatasets'
import { type ScatterPoint } from '@/shared/protocol'

const point = (grp: string, cluster: number, x = 0, y = 0): ScatterPoint => ({
  grp,
  name: grp,
  x,
  y,
  cluster,
})

describe('groupPointsByCluster', () => {
  it('空入力は空の dataset 列', () => {
    expect(groupPointsByCluster([])).toEqual([])
  })

  it('クラスタ番号の昇順に束ね、各 dataset は入力順を保つ', () => {
    const points = [point('a', 1), point('b', 0), point('c', 1), point('d', 2), point('e', 0)]
    const groups = groupPointsByCluster(points)
    expect(groups.map((g) => g.map((p) => p.grp))).toEqual([['b', 'e'], ['a', 'c'], ['d']])
  })

  it('欠番があっても全点を保持する（描画漏れゼロ）', () => {
    // 上流が壊れて {0, 2, 3} を返しても、点は 1 つも落とさない。
    const points = [point('a', 0), point('b', 2), point('c', 3), point('d', 3)]
    const groups = groupPointsByCluster(points)
    expect(groups).toHaveLength(3)
    expect(groups.flat()).toHaveLength(points.length)
    expect(groups.map((g) => g.length)).toEqual([1, 1, 2])
  })

  it('単一クラスタは 1 dataset', () => {
    const points = [point('a', 0), point('b', 0)]
    expect(groupPointsByCluster(points)).toEqual([points])
  })

  it('総点数は常に入力と一致する（1 点も増減しない）', () => {
    const points = Array.from({ length: 50 }, (_, i) => point(`s${i}`, i % 4, i, -i))
    const groups = groupPointsByCluster(points)
    expect(groups.flat()).toHaveLength(points.length)
    expect(new Set(groups.flat().map((p) => p.grp)).size).toBe(points.length)
  })
})
