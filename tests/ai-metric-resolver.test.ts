/**
 * src/ai/metric-resolver：指標キーの決定的な解決（純関数・カタログのみ参照）。
 *
 * LLM の往復（getMetricsCatalog 4〜6 回）を消すための中核。
 * 「近いが無効なキー」を吸収しつつ、**誤った指標を黙って出さない**ことを担保する。
 */

import { describe, expect, it } from 'vitest'
import { getEntry, isRankableKey } from '@/shared/catalog'
import { FUTURE_LEAD_YEAR } from '@/domain/area-summary/totals'
import { defaultKeyForBaseMetric, resolveMetricKey } from '@/ai/metric-resolver'

/** 成功を前提にキーだけ取り出す（失敗ならテストを落とす）。 */
function resolvedKey(spec: Parameters<typeof resolveMetricKey>[0]): string {
  const resolution = resolveMetricKey(spec)
  if (!resolution.ok) throw new Error(`解決できませんでした: ${resolution.error}`)
  return resolution.key
}

describe('resolveMetricKey：完全一致', () => {
  it('正確なキーはそのまま採用し、注記も付けない', () => {
    const resolution = resolveMetricKey({ metric: 'pop_gr_2020_2015_2km' })
    expect(resolution).toEqual({ ok: true, key: 'pop_gr_2020_2015_2km', note: null })
  })

  it('半径非依存の指標（rate_covid）もそのまま採用', () => {
    expect(resolvedKey({ metric: 'rate_covid' })).toBe('rate_covid')
  })

  it('前後の空白は無視する', () => {
    expect(resolvedKey({ metric: '  rate_yoy  ' })).toBe('rate_yoy')
  })

  it('キーと食い違う半径指定はキーを優先し、注記で明示する', () => {
    const resolution = resolveMetricKey({ metric: 'pop_gr_2020_2015_1km', radiusM: 2000 })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.key).toBe('pop_gr_2020_2015_1km')
    expect(resolution.note).toContain('1km')
  })
})

describe('resolveMetricKey：ファミリ名からの解決（往復削減の本体）', () => {
  it('人口増減率は「最新年・スパン5年・半径1km」を既定にする', () => {
    const resolution = resolveMetricKey({ metric: 'pop_gr' })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.key).toBe('pop_gr_2020_2015_1km')
    expect(resolution.note).toContain('2015→2020年')
    expect(resolution.note).toContain('1km')
  })

  it('半径を指定すればその半径で解決する（注記なし＝既定を使っていない）', () => {
    const resolution = resolveMetricKey({ metric: 'pop_gr', radiusM: 2000 })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.key).toBe('pop_gr_2020_2015_2km')
    expect(resolution.note).not.toContain('半径1km')
  })

  it('各ファミリの既定キーがカタログに実在し rankable である', () => {
    for (const base of [
      'pop_gr',
      'lp_gr',
      'bus_gr',
      'estab_gr',
      'emp_gr',
      'pop_gr_pred',
      'pop',
      'lp_med',
      'estab_n',
      'emp_n',
      'bus_n',
    ]) {
      const key = defaultKeyForBaseMetric(base)
      expect(key, `${base} の既定キー`).not.toBeNull()
      if (key === null) continue
      expect(getEntry(key)?.baseMetric).toBe(base)
      expect(isRankableKey(key)).toBe(true)
    }
  })

  it('地価増減率は 5 年スパン（2021→2026）を既定にする', () => {
    expect(defaultKeyForBaseMetric('lp_gr')).toBe('lp_gr_2026_2021_1km')
  })

  it('事業所・従業者の増減率は 2016→2021（5年）を既定にする', () => {
    expect(defaultKeyForBaseMetric('estab_gr')).toBe('estab_gr_2021_2016_1km')
    expect(defaultKeyForBaseMetric('emp_gr')).toBe('emp_gr_2021_2016_1km')
  })

  it('水準指標は最新年を既定にする（人口＝2020年）', () => {
    expect(defaultKeyForBaseMetric('pop')).toBe('pop_2020_1km')
  })

  it('将来推計は最新の推計時点を既定にする', () => {
    const key = defaultKeyForBaseMetric('pop_pred')
    expect(key).not.toBeNull()
    if (key === null) return
    expect(getEntry(key)?.vintage).toBe(2024)
  })
})

describe('resolveMetricKey：将来推計の増減率は 2050 年を既定にする（260728 §10.8）', () => {
  it('年を付けないファミリ名は 2020→2050 年（5 年の規則だと、もう過ぎた 2020→2025 年になる）', () => {
    expect(resolveMetricKey({ metric: 'pop_gr_pred' })).toEqual({
      ok: true,
      key: 'pop_gr_pred_2024_2050_1km',
      note: '半径1km（既定）・2020→2050年（既定）',
    })
  })

  it('既定の終点はエリアの要約が先に言う年と同じ（同じ「将来」が道具ごとに別の年を指さない）', () => {
    const key = defaultKeyForBaseMetric('pop_gr_pred')
    expect(key === null ? null : getEntry(key)?.year).toBe(FUTURE_LEAD_YEAR)
  })

  it('半径を指定しても終点は 2050 年', () => {
    expect(resolvedKey({ metric: 'pop_gr_pred', radiusM: 500 })).toBe('pop_gr_pred_2024_2050_500m')
    expect(resolvedKey({ metric: 'pop_gr_pred', radiusM: 2000 })).toBe('pop_gr_pred_2024_2050_2km')
  })

  it('年を指定すればその年（既定で上書きしない・2040 年なら年の注記も付けない）', () => {
    expect(resolveMetricKey({ metric: 'pop_gr_pred', year: 2040 })).toEqual({
      ok: true,
      key: 'pop_gr_pred_2024_2040_1km',
      note: '半径1km（既定）',
    })
    expect(resolvedKey({ metric: 'pop_gr_pred', year: 2025 })).toBe('pop_gr_pred_2024_2025_1km')
    expect(resolvedKey({ metric: 'pop_gr_pred', year: 2070 })).toBe('pop_gr_pred_2024_2070_1km')
  })

  it('基準年（2020）だけなら、終点は既定の 2050 年', () => {
    expect(resolvedKey({ metric: 'pop_gr_pred', yearBase: 2020 })).toBe('pop_gr_pred_2024_2050_1km')
  })

  it('キーの形で渡しても同じ（年だけ書けばその年・年が無ければ 2050 年）', () => {
    expect(resolvedKey({ metric: 'pop_gr_pred_2040' })).toBe('pop_gr_pred_2024_2040_1km')
    expect(resolvedKey({ metric: 'pop_gr_pred_2km' })).toBe('pop_gr_pred_2024_2050_2km')
  })

  it('推計時点（2024）を年として渡すと、今までどおりエラーで 2050 年も候補に挙げる', () => {
    const resolution = resolveMetricKey({ metric: 'pop_gr_pred', year: 2024 })
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.hint).toContain('2020→2050')
  })

  it('実績の増減率は今までどおり 5 年（例外は将来推計だけ・所得は同じ 2020→2025 年のまま）', () => {
    expect(defaultKeyForBaseMetric('pop_gr')).toBe('pop_gr_2020_2015_1km')
    expect(defaultKeyForBaseMetric('inc_gr')).toBe('inc_gr_2025_2020_1km')
  })
})

describe('resolveMetricKey：表記ゆれの吸収', () => {
  it('年ペアの順序が逆でも解決する（pop_gr_2015_2020_2km）', () => {
    expect(resolvedKey({ metric: 'pop_gr_2015_2020_2km' })).toBe('pop_gr_2020_2015_2km')
  })

  it('年ペアが無いキー（pop_gr_2km）は既定の年ペアで補う', () => {
    expect(resolvedKey({ metric: 'pop_gr_2km' })).toBe('pop_gr_2020_2015_2km')
  })

  it('半径の表記ゆれ（2000m 表記）を吸収する', () => {
    expect(resolvedKey({ metric: 'bus_gr_2000m' })).toBe('bus_gr_2km')
  })

  it('半径を km 数で渡しても解決する（radiusM=2 → 2km）', () => {
    expect(resolvedKey({ metric: 'pop_gr', radiusM: 2 })).toBe('pop_gr_2020_2015_2km')
  })

  it('大文字混じりでも解決する', () => {
    expect(resolvedKey({ metric: 'POP_GR', radiusM: 5000 })).toBe('pop_gr_2020_2015_5km')
  })

  it('年を1つだけ渡した場合は終点年として扱う', () => {
    expect(resolvedKey({ metric: 'pop_gr', year: 2015, radiusM: 1000 })).toBe(
      'pop_gr_2015_2010_1km',
    )
  })

  it('年ペアを明示すればその組合せを使う', () => {
    expect(resolvedKey({ metric: 'pop_gr', year: 2020, yearBase: 1995, radiusM: 1000 })).toBe(
      'pop_gr_2020_1995_1km',
    )
  })
})

describe('resolveMetricKey：半径の扱い', () => {
  it('非対応の半径は最も近い対応半径へ丸め、注記する（地価は 20km 非対応）', () => {
    const resolution = resolveMetricKey({ metric: 'lp_gr', radiusM: 20000 })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(getEntry(resolution.key)?.radiusM).toBe(10000)
    expect(resolution.note).toContain('20km')
    expect(resolution.note).toContain('10km')
  })

  it('半径非依存の指標に半径を渡しても解決し、無視した旨を注記する', () => {
    const resolution = resolveMetricKey({ metric: 'rate_covid', radiusM: 2000 })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.key).toBe('rate_covid')
  })

  it('ファミリ指定＋半径非依存でも同じ（rate ファミリ）', () => {
    const resolution = resolveMetricKey({ metric: 'rate_yoy', radiusM: 5000 })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) return
    expect(resolution.key).toBe('rate_yoy')
  })
})

describe('resolveMetricKey：確定させないケース（誤った指標を黙って出さない）', () => {
  it('未知のファミリはエラー＋候補を返す', () => {
    const resolution = resolveMetricKey({ metric: 'gdp_growth' })
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.error).toContain('未知')
    expect(resolution.hint).toContain('getMetricsCatalog')
  })

  it('ランキング不可の指標（フラグ）はエラー', () => {
    const resolution = resolveMetricKey({ metric: 'pop_lowbase_2015_1km' })
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.error).toContain('使えない')
  })

  it('存在しない年を明示したらエラー＋利用可能な年を返す', () => {
    const resolution = resolveMetricKey({ metric: 'pop_gr', year: 2018, yearBase: 2013 })
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.error).toContain('年')
    expect(resolution.hint).toContain('2020')
  })

  it('空文字はエラー', () => {
    expect(resolveMetricKey({ metric: '   ' }).ok).toBe(false)
  })
})

describe('resolveMetricKey：人口の年齢（2026-11-24・計画書 261122 §7.2）', () => {
  it('年齢のファミリは既定の年と半径で解ける（実績は 2020 年・増減率は 2015→2020・将来は 2050 年）', () => {
    expect(defaultKeyForBaseMetric('pop15_64')).toBe('pop15_64_2020_1km')
    expect(defaultKeyForBaseMetric('pop65_share')).toBe('pop65_share_2020_1km')
    expect(defaultKeyForBaseMetric('pop15_64_gr')).toBe('pop15_64_gr_2020_2015_1km')
    expect(defaultKeyForBaseMetric('pop15_64_gr_pred')).toBe(
      `pop15_64_gr_pred_2024_${FUTURE_LEAD_YEAR}_1km`,
    )
    expect(defaultKeyForBaseMetric('pop65_gr_pred')).toBe('pop65_gr_pred_2024_2050_1km')
    expect(defaultKeyForBaseMetric('pop65_share_pred')).toBe('pop65_share_pred_2024_2050_1km')
  })

  it('最長一致：pop15_64_gr_pred を pop15_64_gr や pop15_64 に解かない', () => {
    expect(resolvedKey({ metric: 'pop15_64_gr_pred_2040_2km' })).toBe(
      'pop15_64_gr_pred_2024_2040_2km',
    )
    expect(resolvedKey({ metric: 'pop15_64_gr_2km' })).toBe('pop15_64_gr_2020_2015_2km')
    expect(resolvedKey({ metric: 'pop65_share_pred' })).toBe('pop65_share_pred_2024_2050_1km')
  })

  it('前方一致の守り：pop_ のあとに年・半径でない語が続く指定は、総数の pop に解かず候補を返す', () => {
    for (const metric of ['pop_15_64_2020_1km', 'pop_young', 'pop_65_share', 'pop_lowbase']) {
      const resolution = resolveMetricKey({ metric })
      expect(resolution.ok, metric).toBe(false)
      if (resolution.ok) continue
      expect(resolution.error).toContain('年・半径でない語')
    }
    const typo = resolveMetricKey({ metric: 'pop_15_64_2020_1km' })
    expect(typo.ok).toBe(false)
    if (typo.ok) return
    expect(typo.didYouMean[0]).toBe('pop15_64')
    expect(typo.hint).toContain('生産年齢人口')
  })

  it('前方一致の守りの候補：前方の一致のあとに、同じカテゴリのファミリ（年齢を含む）を並べる（8 件まで）', () => {
    const young = resolveMetricKey({ metric: 'pop_young_2020_1km' })
    expect(young.ok).toBe(false)
    if (young.ok) return
    expect(young.didYouMean[0]).toBe('pop')
    expect(young.didYouMean).toEqual(expect.arrayContaining(['pop0_14_share', 'pop65_share']))
    expect(young.didYouMean.length).toBeLessThanOrEqual(8)
    expect(young.hint).toContain('年少人口の割合')
    const future = resolveMetricKey({ metric: 'pop_pred_young_2024_2050_1km' })
    expect(future.ok).toBe(false)
    if (future.ok) return
    expect(future.didYouMean.slice(0, 2)).toEqual(['pop_pred', 'pop'])
    expect(future.didYouMean).toEqual(
      expect.arrayContaining(['pop_gr_pred', 'pop15_64_gr_pred', 'pop65_share_pred']),
    )
  })

  it('年・半径・推計の時点だけが続く指定は、今までどおり解く', () => {
    expect(resolvedKey({ metric: 'pop_2020' })).toBe('pop_2020_1km')
    expect(resolvedKey({ metric: 'pop_pred_r6_2050' })).toBe('pop_pred_2024_2050_1km')
    expect(resolvedKey({ metric: 'pop_2020年' })).toBe('pop_2020_1km')
    expect(resolvedKey({ metric: 'pop_gr__2km' })).toBe('pop_gr_2020_2015_2km')
  })

  it('日本語名と同じ指定は、そのファミリで解く（括弧の前でも・全角の括弧でも）。解いたことを注記に書く', () => {
    const aging = resolveMetricKey({ metric: '高齢化率' })
    expect(aging.ok).toBe(true)
    if (!aging.ok) return
    expect(aging.key).toBe('pop65_share_2020_1km')
    expect(aging.note).toContain('「高齢化率」＝pop65_share')
    expect(resolvedKey({ metric: '生産年齢人口' })).toBe('pop15_64_2020_1km')
    expect(resolvedKey({ metric: '生産年齢人口の将来増減率', radiusM: 2000 })).toBe(
      'pop15_64_gr_pred_2024_2050_2km',
    )
    expect(resolvedKey({ metric: '将来の高齢化率' })).toBe('pop65_share_pred_2024_2050_1km')
    expect(resolvedKey({ metric: '高齢化率（65歳以上の割合）' })).toBe('pop65_share_2020_1km')
    expect(resolvedKey({ metric: '人口増減率' })).toBe('pop_gr_2020_2015_1km')
  })

  it('あいまいな日本語は解かず、近いファミリを候補に返す（高齢者・働く世代）', () => {
    const elderly = resolveMetricKey({ metric: '高齢者' })
    expect(elderly.ok).toBe(false)
    if (elderly.ok) return
    expect(elderly.didYouMean).toEqual(expect.arrayContaining(['pop65_share', 'pop65_gr_pred']))
    expect(elderly.hint).toContain('高齢化率')
    const workers = resolveMetricKey({ metric: '働く世代の増え方' })
    expect(workers.ok).toBe(false)
    if (workers.ok) return
    expect(workers.didYouMean).toContain('pop15_64_gr')
  })

  it('日本語の候補：語の字が名前に同じ順で現れるものも拾う。語が名前を含むものは長い名前から', () => {
    const future = resolveMetricKey({ metric: '将来人口' })
    expect(future.ok).toBe(false)
    if (future.ok) return
    expect(future.didYouMean).toEqual(expect.arrayContaining(['pop_pred', 'pop_gr_pred']))
    expect(future.hint).toContain('将来推計人口')
    const shares = resolveMetricKey({ metric: '人口の割合' })
    expect(shares.ok).toBe(false)
    if (shares.ok) return
    expect(shares.didYouMean).toEqual(expect.arrayContaining(['pop15_64_share', 'pop0_14_share']))
    const working = resolveMetricKey({ metric: '2050年の生産年齢人口' })
    expect(working.ok).toBe(false)
    if (working.ok) return
    expect(working.didYouMean.indexOf('pop15_64')).toBeLessThan(working.didYouMean.indexOf('pop'))
  })

  it('日本語の名前がどの指標にも近くなければ、今までどおりカタログを案内する', () => {
    const resolution = resolveMetricKey({ metric: '気温' })
    expect(resolution.ok).toBe(false)
    if (resolution.ok) return
    expect(resolution.hint).toContain('getMetricsCatalog')
    expect(resolution.didYouMean).toEqual([])
  })
})

describe('resolveMetricKey：不変条件', () => {
  it('成功時のキーは必ずカタログに実在し rankable', () => {
    const specs: Parameters<typeof resolveMetricKey>[0][] = [
      { metric: 'pop_gr' },
      { metric: 'pop_gr', radiusM: 500 },
      { metric: 'lp_gr', radiusM: 20000 },
      { metric: 'rate_covid', radiusM: 2000 },
      { metric: 'bus_gr_2000m' },
      { metric: 'pop_gr_2015_2020_2km' },
      { metric: 'emp_n', radiusM: 10000 },
      { metric: 'pop_pred', year: 2050, radiusM: 2000 },
    ]
    for (const spec of specs) {
      const resolution = resolveMetricKey(spec)
      expect(resolution.ok, `${spec.metric} が解決できる`).toBe(true)
      if (!resolution.ok) continue
      expect(isRankableKey(resolution.key), `${resolution.key} は rankable`).toBe(true)
    }
  })

  it('同じ入力は常に同じキーになる（決定的）', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(resolvedKey({ metric: 'pop_gr', radiusM: 2000 })).toBe('pop_gr_2020_2015_2km')
    }
  })
})
