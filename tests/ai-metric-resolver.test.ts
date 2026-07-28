/**
 * src/ai/metric-resolver：指標キーの決定的な解決（純関数・カタログのみ参照）。
 *
 * LLM の往復（getMetricsCatalog 4〜6 回）を消すための中核。
 * 「近いが無効なキー」を吸収しつつ、**誤った指標を黙って出さない**ことを担保する。
 */

import { describe, expect, it } from 'vitest'
import { getEntry, isRankableKey } from '@/shared/catalog'
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

  it('将来人口の増減率も 5 年スパン（2020→2025）を既定にする', () => {
    expect(defaultKeyForBaseMetric('pop_gr_pred')).toBe('pop_gr_pred_2024_2025_1km')
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
