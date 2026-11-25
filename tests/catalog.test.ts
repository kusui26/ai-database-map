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

/** 人口の年齢のファミリ（2026-11-24・docs/261122_PLAN_population_improvement.md §3.3）。 */
const AGE_FAMILIES: ReadonlySet<string> = new Set([
  'pop15_64',
  'pop15_64_share',
  'pop65_share',
  'pop75_share',
  'pop0_14_share',
  'pop15_64_gr',
  'pop15_64_gr_pred',
  'pop65_gr_pred',
  'pop65_share_pred',
])

describe('catalog（Zod ロード）', () => {
  it('874 エントリ・10 属性・カウント整合', () => {
    expect(catalog.entryCount).toBe(874)
    expect(entries.length).toBe(874)
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

  it('カテゴリ別エントリ数の合計が 874', () => {
    const total = CATEGORIES.reduce((sum, cat) => sum + entriesForCategory(cat).length, 0)
    expect(total).toBe(874)
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
    // 他の指標は両者が一致（挙動が変わらないことの保証）。人口の年齢は下の別のテスト（決め方が違う・261124）。
    const others = entries.filter(
      (e) =>
        e.key !== 'rate_covid' && !AGE_FAMILIES.has(e.baseMetric) && e.reliabilityFlagKey !== null,
    )
    expect(others.length).toBeGreaterThan(70)
    for (const e of others) expect(e.noticeFlagKey).toBe(e.reliabilityFlagKey)
  })

  it('人口の年齢：除外は母数のフラグ・注意は年齢不詳のフラグ（計画書 261122 §3.4）', () => {
    // 除外：割合と将来は 2020 年の総数・15〜64 歳の増減率は分母の 2015 年・65 歳以上の将来は 2020 年の 65 歳以上（<50 人）。
    // 注意：補う前の年齢不詳が 10% 以上の駅は補い方で値が動くので、年齢の値すべてに ⚠。2050 年の高齢化率は R6 だけで
    // 作るので年齢不詳と関係が無く、注意は除外と同じ（既定）。母数の小さい駅は順位から外れ、人口タブの年齢の図（PR-3）は
    // 理由ごとに印を出す。
    const exclusion: Record<string, string | null> = {
      pop15_64: null,
      pop15_64_share: 'pop_lowbase_2020',
      pop65_share: 'pop_lowbase_2020',
      pop75_share: 'pop_lowbase_2020',
      pop0_14_share: 'pop_lowbase_2020',
      pop15_64_gr: 'pop_lowbase_2015',
      pop15_64_gr_pred: 'pop_lowbase_2020',
      pop65_gr_pred: 'pop65_lowbase_2020',
      pop65_share_pred: 'pop_lowbase_2020',
    }
    const age = entries.filter((e) => AGE_FAMILIES.has(e.baseMetric))
    expect(age).toHaveLength(66)
    for (const e of age) {
      const radius = radiusToken(e.key)
      const exclude = exclusion[e.baseMetric]
      expect(e.reliabilityFlagKey, e.key).toBe(exclude === null ? null : `${exclude}_${radius}`)
      const notice =
        e.baseMetric === 'pop65_share_pred' ? e.reliabilityFlagKey : `pop_ageunk_2020_${radius}`
      expect(e.noticeFlagKey, e.key).toBe(notice)
      expect(e.rankable).toBe(true)
      const startsWithPop = e.key.startsWith('pop_')
      expect(startsWithPop, `${e.key} は pop_ で始めない（解決器の前方一致）`).toBe(false)
    }
  })

  it('人口の年齢：割合は % で 0〜100（percent1）・水準は人・将来は R6 推計の 2020 年起点', () => {
    const share = requireEntry('pop65_share_2020_1km')
    expect([share.kind, share.unit, share.format]).toEqual(['ratio', '%', 'percent1'])
    expect(share.labelJa).toContain('高齢化率')
    const working = requireEntry('pop15_64_2020_1km')
    expect([working.kind, working.unit, working.format]).toEqual(['level', '人', 'int'])
    expect(working.labelJa).toContain('15〜64歳')
    const future = requireEntry('pop15_64_gr_pred_2024_2040_2km')
    expect([future.category, future.yearBase, future.year, future.vintage]).toEqual([
      'population_forecast',
      2020,
      2040,
      2024,
    ])
    expect(requireEntry('pop65_share_pred_2024_2050_1km').labelJa).toContain('将来の高齢化率')
    for (const flag of ['pop65_lowbase_2020_1km', 'pop_ageunk_2020_1km']) {
      expect(requireEntry(flag).kind).toBe('flag')
      expect(isRankableKey(flag)).toBe(false)
    }
  })

  it('所得：増減率は「分母年」の低分母フラグを見る（docs/income.md §5 の実測）', () => {
    // 率の分母は旧年の 1 人当たりなので、参照するのも旧年。最新年に固定すると
    // 「2015年の分母が 1,000 人未満なのに除外されない」駅が 1km で 90・500m で 203 残る。
    for (const entry of entries.filter((e) => e.baseMetric === 'inc_gr')) {
      expect(entry.yearBase).not.toBeNull()
      expect(entry.reliabilityFlagKey).toBe(`inc_lown_${entry.yearBase}_${radiusToken(entry.key)}`)
    }
  })

  it('所得：総額は除外せず政令市バッジだけを持つ（合計は分母の大小で壊れない）', () => {
    // 1 人当たり（割り算）は低分母で暴れるので除外。総額（合計）は壊れないので除外しない。
    // 政令市は所得が市単位でしか公表されず粒度が粗いだけなので、除外ではなくバッジ。
    for (const entry of entries.filter((e) => e.baseMetric === 'inc_total')) {
      expect(entry.reliabilityFlagKey).toBeNull()
      expect(entry.noticeFlagKey).toBe(`inc_city_only_${radiusToken(entry.key)}`)
    }
    for (const entry of entries.filter((e) => e.baseMetric === 'inc_pc')) {
      expect(entry.reliabilityFlagKey).toBe(`inc_lown_${entry.year}_${radiusToken(entry.key)}`)
      expect(entry.noticeFlagKey).toBe(entry.reliabilityFlagKey)
    }
  })

  it('売上：フラグ以外はすべてランキング・散布図に出す（相対比較がこのアプリの価値・§14）', () => {
    const sales = entries.filter((entry) => entry.category === 'sales')
    expect(sales).toHaveLength(78) // 水準48 + 増減率6 + フラグ24
    for (const entry of sales) {
      expect(entry.rankable, entry.key).toBe(entry.kind !== 'flag')
    }
  })

  it('売上：水準は同年・増減率は「分母年」の低分母フラグを見る（inc_gr と同じ規則）', () => {
    for (const entry of entries.filter((e) => e.category === 'sales' && e.kind === 'level')) {
      expect(entry.reliabilityFlagKey).toBe(`sales_lown_${entry.year}_${radiusToken(entry.key)}`)
    }
    // 増減率は「低分母 or 娯楽の集計定義が非対称」の合成フラグを見る（260817）。
    for (const entry of entries.filter((e) => e.category === 'sales' && e.kind === 'growth')) {
      expect(entry.yearBase).not.toBeNull()
      expect(entry.reliabilityFlagKey).toBe(`sales_gr_unrel_${radiusToken(entry.key)}`)
    }
  })

  it('売上：ラベルに「推計」と「調査年＝売上年」を必ず書く（誠実さ・docs/sales.md §11）', () => {
    // 値は市区町村の売上をメッシュの従業者数で按分した推計で、しかも「前年 1 年間」の売上。
    // どちらもラベルから落とすと、読み手が実測・調査年と取り違える。
    const dest = requireEntry('sales_dest_2021_1km')
    expect(dest.labelJa).toContain('推計')
    expect(dest.labelJa).toContain('2021年調査＝2020年の売上')
    expect(dest.unit).toBe('億円')
    expect(dest.format).toBe('decimal1')
    expect(requireEntry('sales_retail_2016_1km').labelJa).toContain('2016年調査＝2015年の売上')
    expect(requireEntry('sales_retail_2021_1km').labelJa).toContain('卸売を除く')
    expect(requireEntry('sales_leisure_2021_1km').labelJa).toContain('本社一括計上を除く')
  })

  it('売上：増減率の除外は「低分母 or 娯楽の定義が非対称」の合成フラグ（260817）', () => {
    // 娯楽の「総数 − 本所」は本所が秘匿の年は引けず、両年で秘匿の状態が違う 152 団体では
    // 2016↔2021 が同じ定義にならない（docs/sales.md §12-9）。水準は各年の最善値を保ち、
    // 増減率だけ `sales_gr_unrel`（低分母 OR 非対称）で相対比較から外す。
    for (const radius of ['500m', '1km', '2km', '5km', '10km', '20km']) {
      const asym = requireEntry(`sales_asym_${radius}`)
      expect(asym.kind).toBe('flag')
      expect(asym.rankable).toBe(false)
      expect(asym.labelJa).toContain('娯楽')
      const unrel = requireEntry(`sales_gr_unrel_${radius}`)
      expect(unrel.kind).toBe('flag')
      expect(unrel.rankable).toBe(false)
      expect(unrel.labelJa).toContain('低分母')
    }
    // 水準は従来どおり低分母だけを見る（定義の非対称は水準を壊さない）
    for (const entry of entries.filter((e) => e.category === 'sales' && e.kind === 'level')) {
      expect(entry.reliabilityFlagKey).toBe(`sales_lown_${entry.year}_${radiusToken(entry.key)}`)
    }
  })

  it('産業別の従業者数は実測 → 従業者カテゴリ・除外フラグなし（emp_n と同じ扱い）', () => {
    for (const base of ['emp_trade_n', 'emp_food_n', 'emp_life_n']) {
      const list = entries.filter((entry) => entry.baseMetric === base)
      expect(list, base).toHaveLength(12) // 2 年 × 6 半径
      for (const entry of list) {
        expect(entry.category).toBe('employee')
        expect(entry.unit).toBe('人')
        expect(entry.reliabilityFlagKey, entry.key).toBeNull()
        expect(entry.labelJa).not.toContain('推計')
      }
    }
    // 増減率だけは分母が小さいと暴れるので、売上と同じ低分母フラグ（旧年）で除外する。
    for (const base of ['emp_trade_gr', 'emp_food_gr', 'emp_life_gr', 'emp_dest_gr']) {
      const list = entries.filter((entry) => entry.baseMetric === base)
      expect(list, base).toHaveLength(6)
      for (const entry of list) {
        expect(entry.category).toBe('employee')
        expect(entry.reliabilityFlagKey).toBe(`sales_lown_${entry.yearBase}_${radiusToken(entry.key)}`)
      }
    }
  })
})

/** 列名末尾の半径トークン（`inc_pc_2025_1km` → `1km`）。 */
function radiusToken(key: string): string {
  return key.slice(key.lastIndexOf('_') + 1)
}
