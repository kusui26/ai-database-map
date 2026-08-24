import { describe, expect, it } from 'vitest'
import {
  hazardAttributions,
  hazardGroupViews,
  hazardLegend,
  hazardLevelViews,
  heaviestHazardLevel,
  layersNeedingCoverageNote,
  resolveHazardLayerKeys,
} from '@/domain/hazard/catalog'
import { hazardLayers, requireHazardLayer } from '@/shared/hazard'
import { HAZARD_GROUPS, HAZARD_LEVELS } from '@/shared/constants'

describe('domain/hazard: グループ・レベルのビュー', () => {
  it('レイヤを持つグループだけを表示順で返す（realtime は 0 件なので出さない）', () => {
    const views = hazardGroupViews()
    expect(views.map((view) => view.group)).toEqual([
      'flood',
      'inland_flood',
      'storm_surge',
      'tsunami',
      'landslide',
      'terrain',
    ])
    expect(views.every((view) => view.layerKeys.length > 0)).toBe(true)
    expect(views.map((view) => view.group)).not.toContain('realtime')
  })

  it('グループ表示順は constants.HAZARD_GROUPS の部分列', () => {
    const order = hazardGroupViews().map((view) => view.group)
    const indexes = order.map((group) => HAZARD_GROUPS.indexOf(group))
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('レイヤ key の総数がカタログ全件と一致する（取りこぼしがない）', () => {
    const keys = hazardGroupViews().flatMap((view) => view.layerKeys)
    expect(keys.length).toBe(hazardLayers.length)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('危険度は軽い順に全件・ラベルと色つき', () => {
    const views = hazardLevelViews()
    expect(views.map((view) => view.level)).toEqual([...HAZARD_LEVELS])
    expect(views.every((view) => view.labelJa.length > 0 && view.color.startsWith('#'))).toBe(true)
  })
})

describe('domain/hazard: 凡例', () => {
  it('order 昇順（軽い順）で、公式配色は colorUncertain=false', () => {
    const rows = hazardLegend(requireHazardLayer('flood_l2'))
    expect(rows.map((row) => row.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(rows.every((row) => row.colorUncertain === false)).toBe(true)
    expect(rows[4]?.color).toBe('#FFB7B7')
  })

  it('実測配色のレイヤは colorUncertain=true（凡例に注記を出すため）', () => {
    const rows = hazardLegend(requireHazardLayer('dosekiryu'))
    expect(rows.length).toBe(2)
    expect(rows.every((row) => row.colorUncertain === true)).toBe(true)
  })

  it('階級を持たないレイヤ（地形）は空配列', () => {
    expect(hazardLegend(requireHazardLayer('relief'))).toEqual([])
  })
})

describe('domain/hazard: レイヤ key の正規化', () => {
  it('実在しない key を落とし、重複を畳み、カタログ順に並べ直す', () => {
    const resolved = resolveHazardLayerKeys(['naisui', '___missing___', 'flood_l2', 'naisui'])
    expect(resolved).toEqual(['flood_l2', 'naisui'])
  })

  it('空入力は空配列（＝すべて消す）', () => {
    expect(resolveHazardLayerKeys([])).toEqual([])
  })

  it('全 key を渡すとカタログ順そのもの', () => {
    const all = hazardLayers.map((layer) => layer.key)
    expect(resolveHazardLayerKeys([...all].reverse())).toEqual(all)
  })
})

describe('domain/hazard: 出典と注記', () => {
  it('同じ出典は畳んで 1 回だけ返す', () => {
    const attributions = hazardAttributions(['flood_l2', 'flood_l1', 'naisui'])
    expect(attributions).toEqual(['出典：ハザードマップポータルサイト（国土交通省）'])
  })

  it('出典の異なるレイヤを混ぜると両方返る（地理院タイル）', () => {
    const attributions = hazardAttributions(['flood_l2', 'relief'])
    expect(attributions.length).toBe(2)
    expect(attributions.some((text) => text.includes('地理院タイル'))).toBe(true)
  })

  it('実在しない key は出典に混ざらない', () => {
    expect(hazardAttributions(['___missing___'])).toEqual([])
  })

  it('網羅性の注記が要るレイヤを列挙できる（UI が出し忘れない）', () => {
    expect(layersNeedingCoverageNote(['naisui', 'flood_l2'])).toEqual(['flood_l2', 'naisui'])
    expect(layersNeedingCoverageNote(['___missing___'])).toEqual([])
  })
})

describe('domain/hazard: 危険度の合成', () => {
  it('最も重いレベルを返す（空なら none）', () => {
    expect(heaviestHazardLevel([])).toBe('none')
    expect(heaviestHazardLevel(['caution', 'danger', 'warning'])).toBe('danger')
    expect(heaviestHazardLevel(['critical', 'none'])).toBe('critical')
    expect(heaviestHazardLevel(['none'])).toBe('none')
  })

  it('順番によらず同じ結果（可換）', () => {
    const levels = [...HAZARD_LEVELS]
    expect(heaviestHazardLevel(levels)).toBe(heaviestHazardLevel([...levels].reverse()))
  })
})
