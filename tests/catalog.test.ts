import { describe, expect, it } from 'vitest'
import {
  catalog,
  categorySchema,
  entries,
  entriesForCategory,
  getEntry,
  isRankableKey,
  rankableEntries,
  requireEntry,
} from '@/shared/catalog'
import { CATEGORIES, RADII_M } from '@/shared/constants'

describe('catalog（Zod ロード）', () => {
  it('585 エントリ・10 属性・カウント整合', () => {
    expect(catalog.entryCount).toBe(585)
    expect(entries.length).toBe(585)
    expect(catalog.stationAttributes.length).toBe(10)
    expect(catalog.entryCount + catalog.stationAttributeCount).toBe(catalog.columnCount)
  })

  it('category enum が constants.CATEGORIES と一致', () => {
    expect([...categorySchema.options]).toEqual([...CATEGORIES])
    expect(catalog.categories).toEqual([...CATEGORIES])
  })

  it('radii が constants.RADII_M と一致', () => {
    expect(catalog.radii).toEqual([...RADII_M])
  })

  it('getEntry / requireEntry', () => {
    expect(getEntry('pop_2020_1km')?.category).toBe('population')
    expect(getEntry('___missing___')).toBeUndefined()
    expect(() => requireEntry('___missing___')).toThrow()
  })

  it('カテゴリ別エントリ数の合計が 585', () => {
    const total = CATEGORIES.reduce((sum, cat) => sum + entriesForCategory(cat).length, 0)
    expect(total).toBe(585)
  })

  it('rankable は flag / hidden_ratio を含まない', () => {
    expect(rankableEntries.every((e) => e.kind !== 'flag')).toBe(true)
    expect(rankableEntries.some((e) => e.baseMetric === 'pop_hidden_ratio')).toBe(false)
    expect(isRankableKey('pop_2020_1km')).toBe(true)
    expect(isRankableKey('pop_lowbase_2020_1km')).toBe(false)
    expect(isRankableKey('___missing___')).toBe(false)
  })

  it('全エントリの reliabilityFlagKey は実在する flag 種別エントリを指す（再発防止）', () => {
    // かつて flag_yoy/flag_covid は駅属性で entries 外だったため参照先が解決できず、
    // ランキング除外・散布除外・詳細バッジが無効化していた。この不変条件で恒久的に検出する。
    const byKey = new Map(entries.map((e) => [e.key, e]))
    for (const e of entries) {
      if (e.reliabilityFlagKey === null) continue
      const flag = byKey.get(e.reliabilityFlagKey)
      expect(flag, `${e.key} の reliabilityFlagKey=${e.reliabilityFlagKey} がエントリに不在`).toBeDefined()
      expect(flag?.kind).toBe('flag')
    }
  })
})
