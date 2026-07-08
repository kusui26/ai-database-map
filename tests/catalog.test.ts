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
  it('583 エントリ・12 属性・カウント整合', () => {
    expect(catalog.entryCount).toBe(583)
    expect(entries.length).toBe(583)
    expect(catalog.stationAttributes.length).toBe(12)
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

  it('カテゴリ別エントリ数の合計が 583', () => {
    const total = CATEGORIES.reduce((sum, cat) => sum + entriesForCategory(cat).length, 0)
    expect(total).toBe(583)
  })

  it('rankable は flag / hidden_ratio を含まない', () => {
    expect(rankableEntries.every((e) => e.kind !== 'flag')).toBe(true)
    expect(rankableEntries.some((e) => e.baseMetric === 'pop_hidden_ratio')).toBe(false)
    expect(isRankableKey('pop_2020_1km')).toBe(true)
    expect(isRankableKey('pop_lowbase_2020_1km')).toBe(false)
    expect(isRankableKey('___missing___')).toBe(false)
  })

  it('全エントリの reliabilityFlagKey は実在 key を指す', () => {
    const keys = new Set(entries.map((e) => e.key))
    // 識別列のフラグ（flag_yoy/flag_covid）は entries 外なので許容
    const identityFlags = new Set(['flag_yoy', 'flag_covid'])
    for (const e of entries) {
      if (e.reliabilityFlagKey === null) continue
      expect(keys.has(e.reliabilityFlagKey) || identityFlags.has(e.reliabilityFlagKey)).toBe(true)
    }
  })
})
