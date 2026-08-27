import { describe, expect, it } from 'vitest'
import {
  hazardAttributions,
  hazardDrawOrder,
  hazardGroupViews,
  hazardLegend,
  hazardLegendSections,
  hazardLevelViews,
  hazardOpacityFor,
  heaviestHazardLevel,
  layersNeedingCoverageNote,
  resolveHazardLayerKeys,
  toggleHazardLayer,
} from '@/domain/hazard/catalog'
import { hazardLayers, requireHazardLayer } from '@/shared/hazard'
import {
  clampHazardOpacity,
  HAZARD_GROUPS,
  HAZARD_LEVELS,
  HAZARD_OPACITY_DEFAULT,
  HAZARD_OPACITY_MAX,
  HAZARD_OPACITY_MIN,
  HAZARD_TERRAIN_OPACITY_SCALE,
} from '@/shared/constants'

describe('domain/hazard: グループ・レベルのビュー', () => {
  it('レイヤを持つグループだけを表示順で返す（Phase 3 で realtime が入った）', () => {
    const views = hazardGroupViews()
    expect(views.map((view) => view.group)).toEqual([
      'flood',
      'inland_flood',
      'storm_surge',
      'tsunami',
      'landslide',
      'terrain',
      'realtime',
    ])
    expect(views.every((view) => view.layerKeys.length > 0)).toBe(true)
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

describe('domain/hazard: レイヤの ON/OFF（Phase 1a）', () => {
  it('同じグループの base は 1 つだけ（面を重ねると濁って読めない）', () => {
    const afterL2 = toggleHazardLayer([], 'flood_l2')
    expect(afterL2).toEqual(['flood_l2'])
    const afterL1 = toggleHazardLayer(afterL2, 'flood_l1')
    expect(afterL1).toEqual(['flood_l1'])
    expect(toggleHazardLayer(afterL1, 'flood_duration')).toEqual(['flood_duration'])
  })

  it('overlay は base と重ねられ、base を切り替えても残る', () => {
    const withOverlay = toggleHazardLayer(['flood_l2'], 'flood_kaoku_hanran')
    expect(withOverlay).toEqual(['flood_l2', 'flood_kaoku_hanran'])
    // base だけ差し替わり、overlay は生き残る（UI 実測でも同じ挙動）
    expect(toggleHazardLayer(withOverlay, 'flood_l1')).toEqual(['flood_l1', 'flood_kaoku_hanran'])
  })

  it('overlay どうしは何枚でも重なる（土砂 3 種）', () => {
    const one = toggleHazardLayer([], 'dosekiryu')
    const two = toggleHazardLayer(one, 'kyukeisha')
    const three = toggleHazardLayer(two, 'jisuberi')
    expect(three).toEqual(['dosekiryu', 'kyukeisha', 'jisuberi'])
  })

  it('グループが違えば base どうしも重なる（洪水と地形を同時に見る）', () => {
    expect(toggleHazardLayer(['flood_l2'], 'chisui_chikei')).toEqual(['flood_l2', 'chisui_chikei'])
    expect(toggleHazardLayer(['flood_l2'], 'naisui')).toEqual(['flood_l2', 'naisui'])
  })

  it('もう一度押すと消える／未知の key は無視される', () => {
    expect(toggleHazardLayer(['flood_l2', 'naisui'], 'flood_l2')).toEqual(['naisui'])
    expect(toggleHazardLayer(['flood_l2'], '___missing___')).toEqual(['flood_l2'])
  })

  it('描画順は base が先・overlay が後（細い赤がベタ塗りに隠れない）', () => {
    expect(hazardDrawOrder(['flood_kaoku_hanran', 'flood_l2'])).toEqual([
      'flood_l2',
      'flood_kaoku_hanran',
    ])
    expect(hazardDrawOrder(['dosekiryu', 'chisui_chikei'])).toEqual(['chisui_chikei', 'dosekiryu'])
  })

  it('全レイヤに display があり、地形と内水/高潮/津波は base・家屋倒壊と土砂は overlay', () => {
    expect(
      hazardLayers.every((layer) => layer.display === 'base' || layer.display === 'overlay'),
    ).toBe(true)
    const displayOf = (key: string) => requireHazardLayer(key).display
    expect(displayOf('flood_l2')).toBe('base')
    expect(displayOf('flood_kaoku_hanran')).toBe('overlay')
    expect(displayOf('naisui')).toBe('base')
    expect(displayOf('dosekiryu')).toBe('overlay')
    expect(displayOf('relief')).toBe('base')
  })
})

describe('domain/hazard: 凡例セクションと不透明度', () => {
  it('凡例は描画順と同じ並びで、年度・出典・注記が揃う', () => {
    const sections = hazardLegendSections(['flood_kaoku_hanran', 'flood_l2'])
    expect(sections.map((section) => section.layerKey)).toEqual(['flood_l2', 'flood_kaoku_hanran'])
    const first = sections[0]
    expect(first?.vintageJa).toBe('2025年度')
    expect(first?.sourceJa.length).toBeGreaterThan(0)
    expect(first?.coverageNoteJa).not.toBeNull()
    expect(first?.rows.length).toBe(8)
    expect(first?.isTerrain).toBe(false)
  })

  it('地形は isTerrain=true・階級なし・公式凡例へのリンクを持つ', () => {
    const section = hazardLegendSections(['relief'])[0]
    expect(section?.isTerrain).toBe(true)
    expect(section?.rows).toEqual([])
    expect(section?.legendUrl).not.toBeNull()
  })

  it('実在しない key は凡例に出ない', () => {
    expect(hazardLegendSections(['___missing___'])).toEqual([])
  })

  it('不透明度は 0.3–0.9 に丸まり、異常値は既定に戻る', () => {
    expect(clampHazardOpacity(0.6)).toBe(0.6)
    expect(clampHazardOpacity(0)).toBe(HAZARD_OPACITY_MIN)
    expect(clampHazardOpacity(99)).toBe(HAZARD_OPACITY_MAX)
    expect(clampHazardOpacity(Number.NaN)).toBe(HAZARD_OPACITY_DEFAULT)
  })

  it('地形だけ一段薄くなる（ハザードと見分けがつくように）', () => {
    expect(hazardOpacityFor('flood_l2', 0.6)).toBe(0.6)
    expect(hazardOpacityFor('chisui_chikei', 0.6)).toBeCloseTo(
      0.6 * HAZARD_TERRAIN_OPACITY_SCALE,
      6,
    )
    // 未知の key は素通し（描画側が無視する）
    expect(hazardOpacityFor('___missing___', 0.6)).toBe(0.6)
    // 範囲外の入力もここで丸まる
    expect(hazardOpacityFor('flood_l2', 99)).toBe(HAZARD_OPACITY_MAX)
  })
})
