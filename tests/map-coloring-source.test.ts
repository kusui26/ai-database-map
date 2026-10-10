/**
 * 地図の色分けのレイヤ（`src/components/map/coloringSource.ts`・2026-10-11 B5c）の組み立て（純関数の部分）。
 *
 * 見ること：色の付いた駅 → GeoJSON（座標は地図が全駅の GeoJSON から作った索引）。ホバーの文を持つ。座標の分からない駅は
 * 描かず、範囲は描いた駅だけで決める。駅が無ければ範囲は null（寄せない）。
 */

import { describe, expect, it } from 'vitest'
import { coloringFeatures, type StationCoord } from '@/components/map/coloringSource'
import { type ColoredStation } from '@/domain/style/coloring'

const COORDS: ReadonlyMap<string, StationCoord> = new Map([
  ['横浜#0', { lon: 139.622, lat: 35.466, name: '横浜' }],
  ['戸塚#0', { lon: 139.533, lat: 35.401, name: '戸塚' }],
  ['新横浜#0', { lon: 139.617, lat: 35.507, name: '新横浜' }],
])

const STATIONS: readonly ColoredStation[] = [
  { grp: '横浜#0', kind: 'class', color: '#ca0020', classLabelJa: '+5%以上', valueJa: '+5.3%' },
  { grp: '戸塚#0', kind: 'class', color: '#ca0020', classLabelJa: '+5%以上', valueJa: '+11.6%' },
  {
    grp: '新横浜#0',
    kind: 'flagged',
    color: '#9ca3af',
    classLabelJa: '参考値（⚠）',
    valueJa: '+7.4%',
  },
  { grp: '無い駅#9', kind: 'class', color: '#0571b0', classLabelJa: '-5%未満', valueJa: '-6.0%' },
]

describe('色分けの印 → GeoJSON', () => {
  const { collection, bounds } = coloringFeatures(STATIONS, COORDS)

  it('座標の分かる駅だけを、段の色・駅名・ホバーの文つきで描く', () => {
    expect(collection.features).toHaveLength(3)
    expect(collection.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [139.622, 35.466] },
      properties: {
        grp: '横浜#0',
        name: '横浜',
        color: '#ca0020',
        kind: 'class',
        detailJa: '+5.3%・+5%以上',
      },
    })
    expect(collection.features[2]?.properties).toMatchObject({
      kind: 'flagged',
      color: '#9ca3af',
      detailJa: '+7.4%・参考値（⚠）',
    })
  })

  it('範囲は描いた駅だけで決める（座標の無い駅は数えない）', () => {
    expect(bounds).toEqual([139.533, 35.401, 139.622, 35.507])
  })

  it('駅が無ければ空で、範囲は null（寄せない）', () => {
    expect(coloringFeatures([], COORDS)).toEqual({
      collection: { type: 'FeatureCollection', features: [] },
      bounds: null,
    })
    expect(coloringFeatures(STATIONS.slice(3), COORDS).bounds).toBeNull()
  })
})
