import { describe, expect, it } from 'vitest'
import catalog from '@/shared/catalog/catalog.json'

/**
 * 生成済みカタログ（pipeline/build_catalog.py の出力）の構造スモークテスト。
 * CI には data/ CSV が無いため Python の全数検証はローカル限定 → コミット済み
 * catalog.json の破損を CI で検知する軽量ガード（本格的な Zod 検証は P3a）。
 */
describe('metrics catalog (catalog.json)', () => {
  it('列数の整合（値列658 ＋ 駅属性10 ＝ 668）', () => {
    expect(catalog.columnCount).toBe(668)
    expect(catalog.entryCount).toBe(658)
    expect(catalog.entries.length).toBe(catalog.entryCount)
    expect(catalog.stationAttributes.length).toBe(10)
    expect(catalog.entries.length + catalog.stationAttributes.length).toBe(catalog.columnCount)
  })

  it('エントリ key は一意', () => {
    const keys = catalog.entries.map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('全エントリに必須フィールドと既知カテゴリがある', () => {
    const categories = new Set<string>(catalog.categories)
    for (const entry of catalog.entries) {
      expect(entry.key.length).toBeGreaterThan(0)
      expect(entry.labelJa.length).toBeGreaterThan(0)
      expect(entry.source.length).toBeGreaterThan(0)
      expect(entry.license.length).toBeGreaterThan(0)
      expect(categories.has(entry.category)).toBe(true)
    }
  })

  it('reliabilityFlagKey は実在する列を指す', () => {
    const columnKeys = new Set<string>([
      ...catalog.entries.map((entry) => entry.key),
      ...catalog.stationAttributes.map((attr) => attr.key),
    ])
    for (const entry of catalog.entries) {
      if (entry.reliabilityFlagKey !== null) {
        expect(columnKeys.has(entry.reliabilityFlagKey)).toBe(true)
      }
    }
  })
})
