/**
 * エリアの図の画面の規則（純関数・2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。
 *
 * - 行政区域の選択肢（`areaOptions.ts`）：全国と 47 都道府県 → その都道府県の全体・東京 23 区・政令市（全体と区）・市区町村。
 *   駅の数を添え、駅の無い町村も選べる。替えるエリアから都道府県をたどる
 * - 選んでいるエリアの並び（`areaList.ts`）：足す・替える・外す・重ならない・4 つまで・札の名前
 * - 地図の色分けの選び方（`areaColor.ts`）：指標は図の 1 つの半径で引く（AI の道具と同じ）・既定と同じなら URL に書かない・
 *   色分けできない key は既定に戻す・その半径に無い指標は近い半径
 */

import { describe, expect, it } from 'vitest'
import { type AreaCatalogEntry, type AreaSummaryResponse } from '@/shared/area-summary'
import { NO_COLORING } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { rankableVariantGroups, variantTokenOf } from '@/domain/metrics'
import { defaultColorEntry } from '@/domain/style/color-metric'
import {
  areaOptionGroups,
  prefectureOptions,
  prefectureRefOf,
  stationCountJa,
} from '@/components/area/areaOptions'
import {
  canAddArea,
  samePickTarget,
  slotLabels,
  withoutAt,
  withPicked,
} from '@/components/area/areaList'
import {
  COLOR_CATEGORIES,
  colorByAtRadius,
  colorByForCategory,
  colorByForVariant,
  colorSelectionOf,
  normalizeColorBy,
  variantKeyAt,
} from '@/components/area/areaColor'

function entry(
  ref: string,
  kind: AreaCatalogEntry['kind'],
  nameJa: string,
  parentRef: string | null,
  stationCount: number,
  groupRef: string | null = null,
): AreaCatalogEntry {
  return {
    ref,
    kind,
    code: ref.split(':')[1] ?? null,
    nameJa,
    labelJa: nameJa,
    prefecture: null,
    parentRef,
    groupRef,
    stationCount,
    missing: [],
  }
}

/** 本物の一覧（`GET /api/areas`）の形と順（JIS のコード順）を写した小さな一覧。 */
const CATALOG: readonly AreaCatalogEntry[] = [
  entry('jp', 'country', '全国', null, 9273),
  entry('pref:13', 'prefecture', '東京都', 'jp', 654),
  entry('muni:13100', 'special_wards', '東京23区', 'pref:13', 489),
  entry('muni:13101', 'municipality', '千代田区', 'pref:13', 31, 'muni:13100'),
  entry('muni:13102', 'municipality', '中央区', 'pref:13', 22, 'muni:13100'),
  entry('muni:13201', 'municipality', '八王子市', 'pref:13', 21),
  entry('muni:13361', 'municipality', '大島町', 'pref:13', 0),
  entry('pref:14', 'prefecture', '神奈川県', 'jp', 348),
  entry('muni:14100', 'city', '横浜市', 'pref:14', 137),
  entry('muni:14101', 'ward', '横浜市鶴見区', 'muni:14100', 13),
  entry('muni:14109', 'ward', '横浜市港北区', 'muni:14100', 13),
  entry('muni:14130', 'city', '川崎市', 'pref:14', 53),
  entry('muni:14131', 'ward', '川崎市川崎区', 'muni:14130', 9),
  entry('muni:14201', 'municipality', '横須賀市', 'pref:14', 22),
]

describe('行政区域の選択肢（areaOptions）', () => {
  it('1 段目は全国と都道府県（一覧の順）', () => {
    expect(prefectureOptions(CATALOG)).toEqual([
      { ref: 'jp', labelJa: '全国' },
      { ref: 'pref:13', labelJa: '東京都' },
      { ref: 'pref:14', labelJa: '神奈川県' },
    ])
  })

  it('東京都：全体 → 東京 23 区（全体と 23 の区）→ ほかの市区町村（駅の無い町村も「駅なし」で選べる）', () => {
    expect(areaOptionGroups(CATALOG, 'pref:13')).toEqual([
      { labelJa: '全体', options: [{ ref: 'pref:13', labelJa: '東京都の全体・654 駅' }] },
      {
        labelJa: '東京23区',
        options: [
          { ref: 'muni:13100', labelJa: '東京23区の全体・489 駅' },
          { ref: 'muni:13101', labelJa: '千代田区・31 駅' },
          { ref: 'muni:13102', labelJa: '中央区・22 駅' },
        ],
      },
      {
        labelJa: '市区町村',
        options: [
          { ref: 'muni:13201', labelJa: '八王子市・21 駅' },
          { ref: 'muni:13361', labelJa: '大島町（駅なし）' },
        ],
      },
    ])
  })

  it('神奈川県：政令市ごとに全体と区をまとめる（区は市のまとまりにだけ出る）', () => {
    const groups = areaOptionGroups(CATALOG, 'pref:14')
    expect(groups.map((group) => group.labelJa)).toEqual(['全体', '横浜市', '川崎市', '市区町村'])
    expect(groups[1]?.options.map((option) => option.ref)).toEqual([
      'muni:14100',
      'muni:14101',
      'muni:14109',
    ])
    expect(groups[1]?.options[0]?.labelJa).toBe('横浜市の全体・137 駅')
    expect(groups[3]?.options.map((option) => option.ref)).toEqual(['muni:14201'])
  })

  it('全国は全国だけ（「全国の全体」と書かない）', () => {
    expect(areaOptionGroups(CATALOG, 'jp')).toEqual([
      { labelJa: '全体', options: [{ ref: 'jp', labelJa: '全国・9,273 駅' }] },
    ])
  })

  it('知らない都道府県は選択肢なし', () => {
    expect(areaOptionGroups(CATALOG, 'pref:99')).toEqual([])
  })

  it('エリア → 都道府県（区は市を、23 区の区は都をたどる。沿線・範囲は null）', () => {
    expect(prefectureRefOf(CATALOG, 'muni:14109')).toBe('pref:14')
    expect(prefectureRefOf(CATALOG, 'muni:13101')).toBe('pref:13')
    expect(prefectureRefOf(CATALOG, 'pref:13')).toBe('pref:13')
    expect(prefectureRefOf(CATALOG, 'jp')).toBe('jp')
    expect(prefectureRefOf(CATALOG, 'line:26001@1000')).toBeNull()
  })

  it('親がたどれない（壊れた一覧で輪になっている）ときも止まる', () => {
    const loop = [
      entry('muni:1', 'ward', 'A', 'muni:2', 1),
      entry('muni:2', 'ward', 'B', 'muni:1', 1),
    ]
    expect(prefectureRefOf(loop, 'muni:1')).toBeNull()
  })

  it('駅の数の添え書き（千の位の区切り・0 は「駅なし」）', () => {
    expect(stationCountJa(9273)).toBe('・9,273 駅')
    expect(stationCountJa(1)).toBe('・1 駅')
    expect(stationCountJa(0)).toBe('（駅なし）')
  })
})

describe('選んでいるエリアの並び（areaList）', () => {
  it('足すのは末尾、替えるのはその位置', () => {
    expect(withPicked(['muni:14100'], { mode: 'add' }, 'muni:14130')).toEqual([
      'muni:14100',
      'muni:14130',
    ])
    expect(
      withPicked(['muni:14100', 'muni:14130'], { mode: 'replace', index: 1 }, 'pref:14'),
    ).toEqual(['muni:14100', 'pref:14'])
  })

  it('同じエリアは 1 回だけ（前にあるほうを残す）', () => {
    expect(withPicked(['muni:14100'], { mode: 'add' }, 'muni:14100')).toEqual(['muni:14100'])
    expect(
      withPicked(['muni:14100', 'muni:14130'], { mode: 'replace', index: 1 }, 'muni:14100'),
    ).toEqual(['muni:14100'])
  })

  it('4 つまで（5 つ目は入らない）', () => {
    const four = ['jp', 'pref:13', 'pref:14', 'muni:14100']
    expect(canAddArea(four)).toBe(false)
    expect(canAddArea(four.slice(0, 3))).toBe(true)
    expect(withPicked(four, { mode: 'add' }, 'muni:14130')).toEqual(four)
  })

  it('外せるのは 2 つ以上あるときだけ', () => {
    expect(withoutAt(['muni:14100', 'muni:14130'], 0)).toEqual(['muni:14130'])
    expect(withoutAt(['muni:14100'], 0)).toEqual(['muni:14100'])
  })

  it('同じ入れ先か（もう一度押したら閉じる）', () => {
    expect(samePickTarget({ mode: 'add' }, { mode: 'add' })).toBe(true)
    expect(samePickTarget({ mode: 'replace', index: 1 }, { mode: 'replace', index: 1 })).toBe(true)
    expect(samePickTarget({ mode: 'replace', index: 0 }, { mode: 'replace', index: 1 })).toBe(false)
    expect(samePickTarget({ mode: 'add' }, { mode: 'replace', index: 0 })).toBe(false)
  })

  const response = (refs: readonly [string, string][]): AreaSummaryResponse => ({
    areas: refs.map(([ref, labelJa]) => ({
      ref,
      kind: 'city',
      kindJa: '',
      nameJa: labelJa,
      labelJa,
      parent: null,
      areaKm2: null,
      stationCount: 0,
      totals: [],
      unavailableJa: [],
      stations: { count: 0, radiusM: 1000, stats: [] },
      breakdown: null,
    })),
    comparison: null,
    coloring: null,
    legend: null,
    radiusM: 1000,
    notesJa: [],
    notIncludedJa: [],
    sources: [],
  })

  it('札の名前：いまの応答は並びで引く（正規の形に直って返っても名前が付く）', () => {
    const now = response([['line:26001@1000', '東急東横線の沿線（駅から 1km）']])
    expect(slotLabels(['line:26001@1000'], now, now)).toEqual(['東急東横線の沿線（駅から 1km）'])
  })

  it('札の名前：条件を替えた直後は前の応答から同じエリアを探し、無ければ読み込み中（null）', () => {
    const before = response([['muni:14100', '神奈川県横浜市']])
    expect(slotLabels(['muni:14100', 'muni:14130'], undefined, before)).toEqual([
      '神奈川県横浜市',
      null,
    ])
    expect(slotLabels(['muni:14100'], undefined, undefined)).toEqual([null])
  })

  it('札の名前：取得に失敗したら、名前の無い札はエリアの文字列（読み込み中と出し続けない）', () => {
    expect(slotLabels(['muni:99999'], undefined, undefined, true)).toEqual(['muni:99999'])
    const before = response([['muni:14100', '神奈川県横浜市']])
    expect(slotLabels(['muni:14100', 'muni:99999'], undefined, before, true)).toEqual([
      '神奈川県横浜市',
      'muni:99999',
    ])
  })
})

describe('地図の色分けの選び方（areaColor）', () => {
  const DEFAULT_1KM = defaultColorEntry(1000)?.key ?? ''

  it('既定（null）は人口の増減（5 年・その半径）を選んだ形で出す', () => {
    expect(DEFAULT_1KM).toBe('pop_gr_2020_2015_1km')
    expect(colorSelectionOf(null, 1000)).toEqual({
      kind: 'metric',
      key: DEFAULT_1KM,
      category: 'population',
      token: variantTokenOf(DEFAULT_1KM),
    })
  })

  it('色分けしない（none）・色分けできない key（既定に戻す）', () => {
    expect(colorSelectionOf(NO_COLORING, 1000)).toEqual({ kind: 'none' })
    expect(colorSelectionOf('nope', 500)).toMatchObject({ key: 'pop_gr_2020_2015_500m' })
    expect(colorSelectionOf('pop_2020_1km_flag', 1000)).toMatchObject({ key: DEFAULT_1KM })
  })

  it('URL の値に寄せる：既定と同じ key は null・色分けできない key も null・none とほかの key はそのまま', () => {
    expect(normalizeColorBy(DEFAULT_1KM, 1000)).toBeNull()
    expect(normalizeColorBy('nope', 1000)).toBeNull()
    expect(normalizeColorBy(NO_COLORING, 1000)).toBe(NO_COLORING)
    expect(normalizeColorBy(null, 1000)).toBeNull()
    expect(normalizeColorBy('pax_2024', 1000)).toBe('pax_2024')
    // 既定は半径ごとに違う（1km の既定は 500m では既定ではない）
    expect(normalizeColorBy(DEFAULT_1KM, 500)).toBe(DEFAULT_1KM)
  })

  it('カテゴリを選ぶと、その最初の指標を図の半径で引く（none は色分けしない）', () => {
    expect(colorByForCategory(NO_COLORING, 1000, null)).toBe(NO_COLORING)
    const landPrice = colorByForCategory('land_price', 2000, null)
    expect(landPrice).not.toBeNull()
    expect(getEntry(landPrice ?? '')?.category).toBe('land_price')
    expect(colorByForCategory('nope', 1000, 'pax_2024')).toBe('pax_2024')
  })

  it('変種を選ぶと図の半径の key（人口の増減を選び直せば既定＝null に戻る）', () => {
    const token = variantTokenOf('pop_gr_2020_2015_2km') ?? ''
    expect(colorByForVariant('population', token, 1000, 'pax_2024')).toBeNull()
    expect(colorByForVariant('population', token, 2000, null)).toBeNull()
    expect(colorByForVariant('population', 'nope', 1000, 'pax_2024')).toBe('pax_2024')
  })

  it('半径を替えると同じ指標をその半径で引き直す（既定・none・半径の無い指標はそのまま）', () => {
    expect(colorByAtRadius(null, 5000)).toBeNull()
    expect(colorByAtRadius(NO_COLORING, 5000)).toBe(NO_COLORING)
    expect(colorByAtRadius('pax_2024', 5000)).toBe('pax_2024')
    const popAt5km = colorByAtRadius('pop_2020_1km', 5000)
    expect(popAt5km).toBe('pop_2020_5km')
    expect(colorByAtRadius('nope', 5000)).toBeNull()
  })

  it('その半径に無い指標は近い半径（どの変種もいずれかの key に決まる）', () => {
    const variants = COLOR_CATEGORIES.flatMap((category) =>
      rankableVariantGroups(category).flatMap((group) => group.variants),
    )
    expect(variants.length).toBeGreaterThan(0)
    for (const variant of variants) {
      for (const radius of [500, 1000, 2000, 5000, 10000, 20000] as const) {
        const key = variantKeyAt(variant, radius)
        expect(key, `${variant.token}@${radius}`).toBeDefined()
        expect(getEntry(key ?? '')?.rankable, `${key}`).toBe(true)
      }
    }
  })

  it('選べるカテゴリはどれも色分けできる指標を持つ', () => {
    expect(COLOR_CATEGORIES.length).toBeGreaterThan(0)
    for (const category of COLOR_CATEGORIES) {
      expect(rankableVariantGroups(category).length, category).toBeGreaterThan(0)
    }
  })
})
