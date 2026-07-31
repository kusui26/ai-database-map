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
  it('586 エントリ・10 属性・カウント整合', () => {
    expect(catalog.entryCount).toBe(586)
    expect(entries.length).toBe(586)
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

  it('カテゴリ別エントリ数の合計が 586', () => {
    const total = CATEGORIES.reduce((sum, cat) => sum + entriesForCategory(cat).length, 0)
    expect(total).toBe(586)
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
      expect(
        flag,
        `${e.key} の reliabilityFlagKey=${e.reliabilityFlagKey} がエントリに不在`,
      ).toBeDefined()
      expect(flag?.kind).toBe('flag')
    }
  })

  it('noticeFlagKey も実在する flag 種別を指し、除外フラグを持つ指標には必ずある（260731）', () => {
    // バッジ（notice）と除外（reliability）を分けたため、両方に同じ不変条件が要る。
    // notice が欠けると「除外される値なのに無印」という取り違えが起きる。
    const byKey = new Map(entries.map((e) => [e.key, e]))
    for (const e of entries) {
      if (e.reliabilityFlagKey !== null) {
        expect(e.noticeFlagKey, `${e.key} に noticeFlagKey が無い`).not.toBeNull()
      }
      if (e.noticeFlagKey === null) continue
      expect(byKey.get(e.noticeFlagKey)?.kind, `${e.key} の noticeFlagKey`).toBe('flag')
    }
  })

  it('乗降コロナ前後：除外は低分母だけ・バッジは複合フラグ（260731 の恒久対応）', () => {
    // flag_covid は「被覆<100%／pre<2019／|率|>100%」の OR で、被覆で落ちるのは
    // 新宿・横浜・新横浜のような大駅。除外はそこを含めず、注意喚起だけに使う。
    const rateCovid = entries.find((e) => e.key === 'rate_covid')
    expect(rateCovid?.reliabilityFlagKey).toBe('flag_covid_lown')
    expect(rateCovid?.noticeFlagKey).toBe('flag_covid')
    // 他の指標は両者が一致（挙動が変わらないことの保証）
    const others = entries.filter((e) => e.key !== 'rate_covid' && e.reliabilityFlagKey !== null)
    expect(others.length).toBeGreaterThan(70)
    for (const e of others) expect(e.noticeFlagKey).toBe(e.reliabilityFlagKey)
  })
})
