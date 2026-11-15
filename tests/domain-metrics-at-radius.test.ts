import { describe, expect, it } from 'vitest'
import { getEntry } from '@/shared/catalog'
import { CATEGORIES, RADII_M, type RadiusM } from '@/shared/constants'
import {
  DEFAULT_RANKING_KEY,
  DEFAULT_SCATTER_X,
  DEFAULT_SCATTER_Y,
  type MetricVariant,
  radiiOf,
  rankableVariantGroups,
  variantTokenOf,
} from '@/domain/metrics'
import {
  firstKeyAtRadius,
  keyAtRadius,
  openingMetricKey,
  preferredRadius,
  variantKeyNear,
} from '@/domain/metrics/at-radius'

/**
 * 期待値：使える半径のうち、選んだ半径に段の数で最も近いもの（同じ近さなら小さい方）。
 * 実装（`radiiByCloseness`）を使わずに数える。
 */
function nearestAvailable(available: readonly number[], radiusM: RadiusM): number | undefined {
  const steps = (radius: number): number =>
    Math.abs(RADII_M.findIndex((each) => each === radius) - RADII_M.indexOf(radiusM))
  return [...available].sort((a, b) => steps(a) - steps(b) || a - b)[0]
}

const allVariants: readonly MetricVariant[] = CATEGORIES.flatMap((category) =>
  rankableVariantGroups(category).flatMap((group) => group.variants),
)

describe('openingMetricKey：図を開いたときの指標（2026-11-14・地図の半径に合わせる）', () => {
  it('散布の既定の X 軸（定数は 2km）は、地図の半径で開く——地図が 1km なら 1km', () => {
    expect(openingMetricKey(null, DEFAULT_SCATTER_X, 1000)).toBe('pop_gr_2020_2015_1km')
  })

  it('ランキング・散布の既定は、地図のどの半径でもその半径で開く（同じ指標のまま）', () => {
    for (const fallback of [DEFAULT_RANKING_KEY, DEFAULT_SCATTER_X]) {
      for (const radiusM of RADII_M) {
        const key = openingMetricKey(null, fallback, radiusM)
        expect(getEntry(key)?.radiusM).toBe(radiusM)
        expect(variantTokenOf(key)).toBe(variantTokenOf(fallback))
      }
    }
  })

  it('散布の既定の Y 軸（乗降客 コロナ前後比・半径なし）は、どの半径でもそのまま', () => {
    for (const radiusM of RADII_M) {
      expect(openingMetricKey(null, DEFAULT_SCATTER_Y, radiusM)).toBe(DEFAULT_SCATTER_Y)
    }
  })

  it('開いた図に指標があれば、地図の半径で上書きしない（チャットの ⤢・戻る・共有リンク）', () => {
    expect(openingMetricKey('pop_gr_2020_2015_2km', DEFAULT_SCATTER_X, 1000)).toBe(
      'pop_gr_2020_2015_2km',
    )
    expect(openingMetricKey('lp_gr_2026_2016_5km', DEFAULT_RANKING_KEY, 500)).toBe(
      'lp_gr_2026_2016_5km',
    )
  })

  it('カタログに無い指標（手で書き換えた URL）は、既定の指標を地図の半径で', () => {
    expect(openingMetricKey('nope_2km', DEFAULT_RANKING_KEY, 5000)).toBe('pop_gr_2020_2015_5km')
  })
})

describe('keyAtRadius：同じ指標を選んだ半径に（地図の半径が替わったとき）', () => {
  it('半径を持つ指標は、同じ指標・同じ期間のまま半径だけ替わる', () => {
    expect(keyAtRadius('pop_gr_2020_2015_1km', 5000)).toBe('pop_gr_2020_2015_5km')
    expect(keyAtRadius('lp_med_2026_2km', 500)).toBe('lp_med_2026_500m')
  })

  it('その半径が無ければ近い半径へ：地価の増減率は 500m→1km・20km→10km、地価の中央値は 20km→10km', () => {
    expect(keyAtRadius('lp_gr_2026_2025_2km', 500)).toBe('lp_gr_2026_2025_1km')
    expect(keyAtRadius('lp_gr_2026_2025_2km', 20000)).toBe('lp_gr_2026_2025_10km')
    expect(keyAtRadius('lp_med_2026_1km', 20000)).toBe('lp_med_2026_10km')
  })

  it('半径の無い指標（乗降客数・コロナ前後比・最寄の地価公示）と、知らない指標はそのまま', () => {
    for (const key of ['pax_2024', 'rate_covid', 'lp_near_price', 'nope']) {
      expect(keyAtRadius(key, 2000)).toBe(key)
    }
  })

  it('全カテゴリの全指標×全半径：指標は替わらず、半径は使える半径のうち最も近いもの', () => {
    // 空回りしない（ランキング・散布に出せる変種は 100 を超える）
    expect(allVariants.length).toBeGreaterThan(100)
    for (const variant of allVariants) {
      const available = radiiOf(variant)
      const sample = variant.byRadius.values().next().value
      if (sample === undefined) continue
      for (const radiusM of RADII_M) {
        const key = keyAtRadius(sample, radiusM)
        expect(variantTokenOf(key)).toBe(variant.token)
        const expected = available.length === 0 ? null : nearestAvailable(available, radiusM)
        expect(getEntry(key)?.radiusM).toBe(expected)
      }
    }
  })
})

describe('firstKeyAtRadius：カテゴリを替えたときの最初の指標（半径を保つ）', () => {
  it('以前はカテゴリの先頭（500m）に飛んでいた——いまは選んだ半径で', () => {
    expect(firstKeyAtRadius('population', 2000)).toBe('pop_2020_2km')
    expect(firstKeyAtRadius('establishment', 1000)).toBe('estab_n_2021_1km')
  })

  it('最初の指標が半径を持たないカテゴリは、その指標（乗降客数・地価）', () => {
    expect(firstKeyAtRadius('passenger', 2000)).toBe('pax_2011')
    expect(firstKeyAtRadius('land_price', 2000)).toBe('lp_near_price')
  })

  it('全カテゴリ×全半径：そのカテゴリの最初の指標で、半径は使える半径のうち最も近いもの', () => {
    for (const category of CATEGORIES) {
      const first = rankableVariantGroups(category)[0]?.variants[0]
      for (const radiusM of RADII_M) {
        const key = firstKeyAtRadius(category, radiusM)
        expect(key).toBeDefined()
        expect(getEntry(key ?? '')?.category).toBe(category)
        expect(variantTokenOf(key ?? '')).toBe(first?.token)
        const available = first === undefined ? [] : radiiOf(first)
        const expected = available.length === 0 ? null : nearestAvailable(available, radiusM)
        expect(getEntry(key ?? '')?.radiusM).toBe(expected)
      }
    }
  })
})

describe('preferredRadius：指標を選び直すときに合わせる半径', () => {
  it('いまの指標が半径を持てばその半径、持たなければ（知らない指標も）地図の半径', () => {
    expect(preferredRadius('pop_gr_2020_2015_5km', 1000)).toBe(5000)
    expect(preferredRadius('rate_covid', 2000)).toBe(2000)
    expect(preferredRadius('nope', 500)).toBe(500)
  })
})

describe('variantKeyNear：変種の、選んだ半径に最も近い指標', () => {
  const variant = (byRadius: ReadonlyMap<number | null, string>): MetricVariant => ({
    baseMetric: 'x',
    token: 'x',
    labelJa: 'x',
    byRadius,
  })

  it('同じ近さの半径が 2 つあれば小さい方（2km に対して 1km と 5km は 1 段ずつ）', () => {
    const v = variant(
      new Map([
        [1000, 'x_1km'],
        [5000, 'x_5km'],
      ]),
    )
    expect(variantKeyNear(v, 2000)).toBe('x_1km')
  })

  it('半径の無い変種はその指標・どの半径も無ければ undefined', () => {
    expect(variantKeyNear(variant(new Map([[null, 'x']])), 2000)).toBe('x')
    expect(variantKeyNear(variant(new Map()), 2000)).toBeUndefined()
  })
})
