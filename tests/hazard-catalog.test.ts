import { describe, expect, it } from 'vitest'
import {
  HAZARD_DISCLAIMER_JA,
  evacuationActionSchema,
  getHazardLayer,
  hazardCatalog,
  hazardGroupSchema,
  hazardLayers,
  hazardLayersForGroup,
  hazardLevelSchema,
  isHazardLayerKey,
  isHazardLevel,
  rankOf,
  requireHazardLayer,
} from '@/shared/hazard'
import {
  EVACUATION_LABELS_JA,
  HAZARD_GROUPS,
  HAZARD_LEVELS,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_ICONS,
  HAZARD_LEVEL_LABELS_JA,
  hazardLevelWeight,
} from '@/shared/constants'

/**
 * ハザード・レイヤカタログ（`pipeline/hazard_rules.py` が生成）の不変条件。
 * カタログは「凡例 UI と AI が読む単一の真実」なので、
 * **語彙が constants とズレない・階級が壊れていない・注記と出典が欠けない**を機械で守る。
 */

describe('hazard カタログ（Zod ロード）', () => {
  it('15 レイヤ・カウント整合・生成元が rules', () => {
    expect(hazardCatalog.layerCount).toBe(15)
    expect(hazardLayers.length).toBe(hazardCatalog.layerCount)
    expect(hazardCatalog.generatedFrom).toBe('pipeline/hazard_rules.py')
    expect(hazardCatalog.version).toBeGreaterThanOrEqual(1)
  })

  it('group enum が constants.HAZARD_GROUPS と一致（順序も）', () => {
    expect([...hazardGroupSchema.options]).toEqual([...HAZARD_GROUPS])
    expect(hazardCatalog.groups).toEqual([...HAZARD_GROUPS])
  })

  it('level enum が constants.HAZARD_LEVELS と一致（軽い順）', () => {
    expect([...hazardLevelSchema.options]).toEqual([...HAZARD_LEVELS])
    expect(hazardCatalog.levels).toEqual([...HAZARD_LEVELS])
  })

  it('最も軽いレベルは safe ではなく none（白＝安全と読ませない）', () => {
    expect(HAZARD_LEVELS[0]).toBe('none')
    expect(HAZARD_LEVEL_LABELS_JA.none).toBe('想定区域外')
    expect(hazardLevelWeight('none')).toBe(0)
    expect(hazardLevelWeight('critical')).toBe(HAZARD_LEVELS.length - 1)
  })

  it('全レベルにラベル・色・記号が揃う（色だけで伝えない・§7.6）', () => {
    for (const level of HAZARD_LEVELS) {
      expect(HAZARD_LEVEL_LABELS_JA[level]?.length, level).toBeGreaterThan(0)
      expect(HAZARD_LEVEL_COLORS[level], level).toMatch(/^#[0-9a-f]{6}$/)
      expect(HAZARD_LEVEL_ICONS[level]?.length, level).toBeGreaterThan(0)
    }
  })

  it('避難行動 enum が constants.EVACUATION_LABELS_JA と 1 対 1', () => {
    expect([...evacuationActionSchema.options].sort()).toEqual(
      Object.keys(EVACUATION_LABELS_JA).sort(),
    )
  })

  it('免責が空でない（全応答に添える 1 文）', () => {
    expect(HAZARD_DISCLAIMER_JA).toContain('市町村')
    expect(HAZARD_DISCLAIMER_JA.length).toBeGreaterThan(20)
  })
})

describe('hazard カタログ: レイヤの不変条件', () => {
  it('key は一意', () => {
    const keys = hazardLayers.map((layer) => layer.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('グループ別の件数の合計が全件（realtime は Phase 3 まで 0 件）', () => {
    const total = HAZARD_GROUPS.reduce((sum, group) => sum + hazardLayersForGroup(group).length, 0)
    expect(total).toBe(hazardLayers.length)
    expect(hazardLayersForGroup('realtime').length).toBe(0)
    expect(hazardLayersForGroup('flood').length).toBeGreaterThan(0)
  })

  it('すべてのレイヤに出典・ライセンス・attribution がある（出典表示は利用条件）', () => {
    for (const layer of hazardLayers) {
      expect(layer.source.length, layer.key).toBeGreaterThan(0)
      expect(layer.license.length, layer.key).toBeGreaterThan(0)
      expect(layer.attribution, layer.key).toContain('出典')
    }
  })

  it('タイル URL は XYZ テンプレート（{z}/{x}/{y}）で https', () => {
    for (const layer of hazardLayers) {
      if (layer.tile === null) continue
      expect(layer.tile.url, layer.key).toMatch(/^https:\/\//)
      expect(layer.tile.url, layer.key).toContain('{z}/{x}/{y}')
      expect(layer.tile.minZoom, layer.key).toBeLessThanOrEqual(layer.tile.maxZoom)
    }
  })

  it('階級は order 昇順の連番で、色は #RRGGBB（大文字）', () => {
    for (const layer of hazardLayers) {
      const orders = layer.ranks.map((rank) => rank.order)
      expect(orders, layer.key).toEqual(orders.map((_, index) => index + 1))
      for (const rank of layer.ranks) {
        if (rank.color !== null)
          expect(rank.color, `${layer.key}/${rank.order}`).toMatch(/^#[0-9A-F]{6}$/)
        expect(rank.labelJa.length, `${layer.key}/${rank.order}`).toBeGreaterThan(0)
        expect(rank.meaningJa.length, `${layer.key}/${rank.order}`).toBeGreaterThan(0)
      }
    }
  })

  it('量の階級（m / hour）は下限が単調増加で、区間が連続する', () => {
    for (const layer of hazardLayers) {
      if (layer.rankUnit === null) continue
      const mins = layer.ranks.map((rank) => rank.min)
      expect(
        mins.every((min) => min !== null),
        layer.key,
      ).toBe(true)
      layer.ranks.forEach((rank, index) => {
        const next = layer.ranks[index + 1]
        if (next === undefined) {
          expect(rank.max, `${layer.key} 最終階級は上限なし`).toBeNull()
          return
        }
        expect(rank.max, `${layer.key}/${rank.order}`).toBe(next.min)
      })
    }
  })

  it('階級の危険度は order とともに重くなる（軽い階級が重い階級より重くならない）', () => {
    for (const layer of hazardLayers) {
      layer.ranks.forEach((rank, index) => {
        const next = layer.ranks[index + 1]
        if (next === undefined) return
        expect(
          hazardLevelWeight(next.level),
          `${layer.key}: ${rank.order}→${next.order}`,
        ).toBeGreaterThanOrEqual(hazardLevelWeight(rank.level))
      })
    }
  })

  it('色が未確定の階級は colorSource も null（確からしさを型に残す）', () => {
    for (const layer of hazardLayers) {
      for (const rank of layer.ranks) {
        if (rank.color === null) expect(rank.colorSource, `${layer.key}/${rank.order}`).toBeNull()
        else expect(rank.colorSource, `${layer.key}/${rank.order}`).not.toBeNull()
      }
    }
  })

  it('浸水深レイヤは 8 階級・共通の配色（タイルが詳細版で描かれているため）', () => {
    const depthLayers = ['flood_l2', 'flood_l1', 'naisui', 'hightide_l2', 'tsunami_shinsui']
    const reference = requireHazardLayer('flood_l2').ranks.map((rank) => rank.color)
    expect(reference).toEqual([
      '#FFFFB3',
      '#F7F5A9',
      '#F8E1A6',
      '#FFD8C0',
      '#FFB7B7',
      '#FF9191',
      '#F285C9',
      '#DC7ADC',
    ])
    for (const key of depthLayers) {
      const layer = requireHazardLayer(key)
      expect(layer.rankUnit, key).toBe('m')
      expect(layer.ranks.length, key).toBe(8)
      expect(
        layer.ranks.map((rank) => rank.color),
        key,
      ).toEqual(reference)
    }
  })

  it('浸水深 3m 以上は danger 以上（§6.2 の立退き判定と閾値が揃う）', () => {
    for (const rank of requireHazardLayer('flood_l2').ranks) {
      if (rank.min !== null && rank.min >= 3) {
        expect(hazardLevelWeight(rank.level), rank.labelJa).toBeGreaterThanOrEqual(
          hazardLevelWeight('danger'),
        )
      }
    }
  })

  it('浸水継続時間は 7 階級・単位 hour', () => {
    const layer = requireHazardLayer('flood_duration')
    expect(layer.rankUnit).toBe('hour')
    expect(layer.ranks.length).toBe(7)
    expect(layer.ranks[6]?.min).toBe(672)
  })

  it('家屋倒壊等氾濫は critical（垂直避難では命を守れない）', () => {
    for (const key of ['flood_kaoku_hanran', 'flood_kaoku_kagan']) {
      const layer = requireHazardLayer(key)
      expect(layer.ranks.length, key).toBe(1)
      expect(layer.ranks[0]?.level, key).toBe('critical')
      expect(layer.ranks[0]?.actionJa, key).toContain('立退き')
    }
  })

  it('内水は強い網羅性の注記を持ち、地形の代替レイヤを指す（§3.7）', () => {
    const layer = requireHazardLayer('naisui')
    expect(layer.coverageNoteJa).toContain('22')
    expect(layer.coverageNoteJa).toContain('意味ではありません')
    expect(layer.fallbackLayersJa.length).toBeGreaterThan(0)
    expect(layer.fallbackLayersJa).toContain('治水地形分類図')
  })

  it('地形レイヤはハザードではない：階級を持たず、注記でそう言い、公式凡例へリンクする', () => {
    const terrain = hazardLayersForGroup('terrain')
    expect(terrain.length).toBe(4)
    for (const layer of terrain) {
      expect(layer.ranks.length, layer.key).toBe(0)
      expect(layer.legendUrl, layer.key).not.toBeNull()
      expect(layer.coverageNoteJa, layer.key).toContain('浸水想定ではなく')
      expect(layer.mesh, layer.key).toBeNull()
    }
  })

  it('メッシュ化したのは洪水 5 レイヤ＋内水のみ（決定 4）', () => {
    const meshed = hazardLayers.filter((layer) => layer.mesh !== null).map((layer) => layer.key)
    expect(meshed.sort()).toEqual(
      [
        'flood_duration',
        'flood_kaoku_hanran',
        'flood_kaoku_kagan',
        'flood_l1',
        'flood_l2',
        'naisui',
      ].sort(),
    )
    // Phase 1b で配布開始・PR-1 で v2（1 セル 1 バイト）。実体は public/hazard/**。
    for (const key of meshed) {
      const mesh = hazardLayers.find((layer) => layer.key === key)?.mesh
      expect(mesh?.available, key).toBe(true)
      expect(mesh?.pathTemplate, key).toBe('hazard/{layer}/{primary}.bin.gz')
    }
  })
})

describe('hazard カタログ: 参照ヘルパ', () => {
  it('getHazardLayer / requireHazardLayer', () => {
    expect(getHazardLayer('flood_l2')?.group).toBe('flood')
    expect(getHazardLayer('___missing___')).toBeUndefined()
    expect(() => requireHazardLayer('___missing___')).toThrow(/未知のハザードレイヤ/)
  })

  it('isHazardLayerKey / isHazardLevel', () => {
    expect(isHazardLayerKey('naisui')).toBe(true)
    expect(isHazardLayerKey('___missing___')).toBe(false)
    expect(isHazardLevel('critical')).toBe(true)
    expect(isHazardLevel('safe')).toBe(false)
    expect(isHazardLevel(3)).toBe(false)
  })

  it('rankOf は order で階級を引く', () => {
    const layer = requireHazardLayer('flood_l2')
    expect(rankOf(layer, 5)?.labelJa).toBe('3〜5m 未満')
    expect(rankOf(layer, 99)).toBeUndefined()
  })
})
