/**
 * 駅周辺のプロフィール（`src/domain/profile/`・2026-10-09 B4・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * DB を使わずに固定するのは：
 * - **載せる指標と年**（カタログから決まる）と、半径が無い指標を**近い半径に替えて言う**こと
 * - **位置の言い方**（上位／下位の境・切り上げ・比べる駅が少ないときは出さない・「県内」「都内」「市内」）
 * - **性格の目安の規則**（閾値の境目・人口 0・欠損）と根拠の文
 * - 災害の要約（重い順・「近く」と「区域図なし」・限界と出典を必ず添える）
 * - 組み立て（政令市の所得は市内で比べない・⚠ の注記・市内で比べられないときの注記・出典を分ける）
 *
 * 県内・市内の順位を数える SQL は `pipeline/golden_profile_test.py` が本物の DB で確かめる。
 */

import { describe, expect, it } from 'vitest'
import { requireEntry } from '@/shared/catalog'
import { RADII_M } from '@/shared/constants'
import { stationProfileSchema } from '@/shared/api'
import { panelSchema } from '@/shared/protocol'
import {
  incomeCityOnlyFlagKey,
  PROFILE_SECTIONS,
  rankedKeys,
  resolveProfileSections,
} from '@/domain/profile/items'
import { radiiByCloseness } from '@/domain/metrics/family'
import { periodOf } from '@/domain/metrics'
import {
  MIN_COMPARED_STATIONS,
  percentileOf,
  positionOf,
  positionsLegendJa,
  shareJa,
  shortScopeJa,
} from '@/domain/profile/position'
import {
  BUSINESS_MIN_RATIO,
  CHARACTER_RADIUS_M,
  CHARACTER_RULE_JA,
  classifyArea,
  MIXED_MIN_RATIO,
  SPARSE_PEOPLE_PER_KM2,
} from '@/domain/profile/character'
import { profileHazardOf } from '@/domain/profile/hazard'
import {
  buildStationProfile,
  comparisonAreaOf,
  PROFILE_CIRCLE_NOTE_JA,
  PROFILE_FLAG_NOTE_JA,
  PROFILE_NOT_COVERED_JA,
  PROFILE_RANK_NOTE_JA,
  type StationProfileInput,
} from '@/domain/profile/build'
import { profileTitleOf, stationProfilePanel } from '@/domain/profile/panel'
import { HAZARD, rank, ranksFor, VALUES_1KM, VALUES_500M, YOKOHAMA } from './fixtures/profile'

function inputFor(overrides: Partial<StationProfileInput> = {}): StationProfileInput {
  const sections = resolveProfileSections(overrides.radiusM ?? 1000)
  return {
    station: YOKOHAMA,
    radiusM: 1000,
    sections,
    values: new Map(Object.entries({ ...VALUES_1KM, ...VALUES_500M })),
    ranks: ranksFor(rankedKeys(sections), rank(66, 348, [37, 137])),
    area: '横浜市',
    hazard: HAZARD,
    ...overrides,
  }
}

function itemOf(profile: ReturnType<typeof buildStationProfile>, id: string) {
  const item = profile.sections.flatMap((section) => section.items).find((each) => each.id === id)
  if (item === undefined) throw new Error(`項目がありません: ${id}`)
  return item
}

// --- 載せる指標（items.ts） --------------------------------------------------

describe('載せる指標と年（カタログから決める）', () => {
  it('1km 圏：11 指標・人口の増減は 5 年・将来は 20 年先・地価の増減は 5 年', () => {
    expect(rankedKeys(resolveProfileSections(1000))).toEqual([
      'pop_2020_1km',
      'pop_gr_2020_2015_1km',
      'pop_gr_pred_2024_2040_1km',
      'inc_pc_2025_1km',
      'lp_med_2026_1km',
      'lp_gr_2026_2021_1km',
      'emp_n_2021_1km',
      'estab_n_2021_1km',
      'sales_dest_2021_1km',
      'pax_2024',
      'bus_n_1km',
    ])
  })

  it('どの半径でも 11 指標が揃う（半径が無い指標は近い半径に替える）', () => {
    const items = PROFILE_SECTIONS.flatMap((section) => section.items)
    for (const radius of RADII_M) {
      expect(rankedKeys(resolveProfileSections(radius)), `${radius}`).toHaveLength(items.length)
    }
  })

  it('替えるのは地価だけ：500m は増減率を 1km、20km は中央値・増減率を 10km', () => {
    const substituted = (radius: (typeof RADII_M)[number]) =>
      resolveProfileSections(radius)
        .flatMap((section) => section.items)
        .filter((item) => item.substituted)
        .map((item) => item.entry.key)
    expect(substituted(500)).toEqual(['lp_gr_2026_2021_1km'])
    expect(substituted(20000)).toEqual(['lp_med_2026_10km', 'lp_gr_2026_2021_10km'])
    for (const radius of [1000, 2000, 5000, 10000] as const) expect(substituted(radius)).toEqual([])
  })

  it('乗降客数は駅の値（半径なし）で、替えたことにしない', () => {
    const passengers = resolveProfileSections(500)
      .flatMap((section) => section.items)
      .find((item) => item.spec.id === 'passengers')
    expect(passengers?.entry.key).toBe('pax_2024')
    expect(passengers?.substituted).toBe(false)
  })

  it('近い半径の順（段の数で測り、同じ近さなら小さい方）', () => {
    expect(radiiByCloseness(500)).toEqual([500, 1000, 2000, 5000, 10000, 20000])
    expect(radiiByCloseness(20000)).toEqual([20000, 10000, 5000, 2000, 1000, 500])
    expect(radiiByCloseness(2000)).toEqual([2000, 1000, 5000, 500, 10000, 20000])
  })

  it('所得の政令市フラグはその半径のもの（無い半径は null）', () => {
    expect(incomeCityOnlyFlagKey(1000)).toBe('inc_city_only_1km')
    expect(incomeCityOnlyFlagKey(500)).toBe('inc_city_only_500m')
    expect(incomeCityOnlyFlagKey(3000)).toBeNull()
  })

  it('いつの値か：年・期間・推計・年度・調査の年・現行', () => {
    expect(periodOf(requireEntry('pop_2020_1km'))).toBe('2020年')
    expect(periodOf(requireEntry('pop_gr_2020_2015_1km'))).toBe('2015→2020年')
    expect(periodOf(requireEntry('pop_gr_pred_2024_2040_1km'))).toBe('2020→2040年・R6推計')
    expect(periodOf(requireEntry('inc_pc_2025_1km'))).toBe('2025年度')
    expect(periodOf(requireEntry('sales_dest_2021_1km'))).toBe('2021年調査')
    expect(periodOf(requireEntry('bus_n_1km'))).toBe('現行')
    expect(periodOf(requireEntry('pax_2024'))).toBe('2024年')
  })
})

// --- 位置（position.ts） ----------------------------------------------------

describe('位置の言い方（上位／下位・切り上げ）', () => {
  it.each([
    [1, 348, '上位 1%'],
    [66, 348, '上位 19%'],
    [174, 348, '上位 50%'],
    [175, 348, '下位 50%'],
    [348, 348, '下位 1%'],
    [3, 100, '上位 3%'], // 浮動小数で 3.0000000000000004 → 4% にしない
    [1, 5, '上位 20%'],
    [3, 5, '真ん中'], // 奇数のちょうど中央（上からも下からも 60%）
    [4, 5, '下位 40%'],
    [27, 53, '真ん中'], // 「下位 51%」と言わない
    [26, 53, '上位 50%'],
    [28, 53, '下位 50%'],
    [2, 4, '上位 50%'], // 偶数には真ん中の 1 駅が無い
    [3, 4, '下位 50%'],
  ])('%i / %i → %s', (rankValue, total, expected) => {
    expect(shareJa(rankValue, total)).toBe(expected)
  })

  it('目盛りは 0〜100（100＝最も大きい・小数 1 桁）。1 駅なら真ん中', () => {
    expect(percentileOf(1, 348)).toBe(100)
    expect(percentileOf(348, 348)).toBe(0)
    expect(percentileOf(66, 348)).toBe(81.3)
    expect(percentileOf(1, 1)).toBe(50)
  })

  it('比べる駅が 5 駅未満・順位が範囲の外・整数でなければ出さない', () => {
    expect(MIN_COMPARED_STATIONS).toBe(5)
    expect(positionOf('area', '瑞穂町', 1, 4)).toBeNull()
    expect(positionOf('area', '府中市', 1, 5)).not.toBeNull()
    expect(positionOf('prefecture', '東京都', 0, 654)).toBeNull()
    expect(positionOf('prefecture', '東京都', 655, 654)).toBeNull()
    expect(positionOf('prefecture', '東京都', 1.5, 654)).toBeNull()
  })

  it('位置の文：「東京都内 637 駅中 5 位（上位 1%）」・短い言い方は「都内」', () => {
    expect(positionOf('prefecture', '東京都', 5, 637)).toEqual({
      scope: 'prefecture',
      scopeJa: '東京都内',
      shortJa: '都内',
      rank: 5,
      total: 637,
      percentile: 99.4,
      shareJa: '上位 1%',
      labelJa: '東京都内 637 駅中 5 位（上位 1%）',
    })
  })

  it.each([
    ['神奈川県', '県内'],
    ['東京都', '都内'],
    ['大阪府', '府内'],
    ['北海道', '道内'],
    ['横浜市', '市内'],
    ['千代田区', '区内'],
    ['瑞穂町', '町内'],
    ['檜原村', '村内'],
  ])('%s → %s', (name, expected) => {
    expect(shortScopeJa(name)).toBe(expected)
  })

  it('凡例はどこの県・市かを言う（市内が無ければ県内だけ）', () => {
    expect(positionsLegendJa('神奈川県', '横浜市')).toBe(
      '位置は 県内＝神奈川県、市内＝横浜市 の駅と比べたものです（値の大きい順・数字は順位/駅数）。',
    )
    expect(positionsLegendJa('東京都', null)).toBe(
      '位置は 都内＝東京都 の駅と比べたものです（値の大きい順・数字は順位/駅数）。',
    )
  })
})

// --- 性格の目安（character.ts） ---------------------------------------------

describe('性格の目安（規則で決め、根拠の数を添える）', () => {
  const years = { populationYear: 2020, employeesYear: 2021 }
  const classify = (population: number | null, employees: number | null) =>
    classifyArea({ population, employees, ...years })

  it('閾値（業務地型 1・混在型 0.5・低密度 1,000 人/km²・判定は 1km 圏）', () => {
    expect(BUSINESS_MIN_RATIO).toBe(1)
    expect(MIXED_MIN_RATIO).toBe(0.5)
    expect(SPARSE_PEOPLE_PER_KM2).toBe(1000)
    expect(CHARACTER_RADIUS_M).toBe(1000)
  })

  it('横浜：従業者が人口の 4.1 倍＝業務地型（根拠の文に年と人数）', () => {
    expect(classify(43_471, 179_031)).toEqual({
      kind: 'business',
      labelJa: '業務地型',
      summaryJa: '働きに来る人が、住む人より多いエリア',
      basisJa: '1km圏の従業者 179,031 人（2021年）は、人口 43,471 人（2020年）の 4.1 倍',
      radiusM: 1000,
    })
  })

  it.each([
    [10_000, 10_000, 'business'], // ちょうど 1 倍は業務地型
    [10_000, 9_999, 'mixed'],
    [10_000, 5_000, 'mixed'], // ちょうど 0.5 倍は混在型
    [10_000, 4_999, 'residential'],
  ])('人口 %i・従業者 %i → %s', (population, employees, kind) => {
    expect(classify(population, employees).kind).toBe(kind)
  })

  it('人と職場が 1km² あたり 1,000 人未満なら低密度（境目は円の面積 π km² で測る）', () => {
    // π km² × 1,000 人 ≒ 3,141.6 人
    expect(classify(2_500, 642).kind).toBe('residential') // 3,142 人＝1,000.1 人/km²
    expect(classify(2_500, 641).kind).toBe('sparse') // 3,141 人＝999.8 人/km²
  })

  it('密度は切り捨てで書く（999.8 人を「1,000 人」と書くと「1,000 人未満」と食い違う）', () => {
    expect(classify(2_500, 641).basisJa).toBe(
      '1km圏の人口 2,500 人と従業者 641 人は、合わせて 1km² あたり 999 人',
    )
  })

  it('比は小数 1 桁に切り捨てて書く（0.4999 倍を「0.5 倍」と書くと型と食い違う）', () => {
    expect(classify(10_000, 4_999).basisJa).toContain('の 0.4 倍')
    expect(classify(10_000, 9_999).basisJa).toContain('の 0.9 倍')
    expect(classify(10_000, 5_000).basisJa).toContain('の 0.5 倍')
    expect(classify(4_248, 565_228).basisJa).toContain('の 133.0 倍') // 東京駅（133.06…）
  })

  it('低密度は比より先に見る（工場が 1 つある田園で「業務地型」と言わない）', () => {
    expect(classify(100, 500).kind).toBe('sparse')
  })

  it('人口 0 で従業者がいれば業務地型（割り算を出さずに言う）', () => {
    const character = classify(0, 5_000)
    expect(character.kind).toBe('business')
    expect(character.basisJa).toBe('1km圏の従業者 5,000 人（2021年）に対し、人口は 0 人（2020年）')
  })

  it('どちらかが無い・負なら「判定できません」（根拠は空）', () => {
    for (const [population, employees] of [
      [null, 100],
      [100, null],
      [-1, 100],
    ] as const) {
      const character = classify(population, employees)
      expect(character.kind).toBe('unknown')
      expect(character.basisJa).toBe('')
    }
  })

  it('規則の文は閾値の数を含む（画面と AI に同じ文を出す）', () => {
    expect(CHARACTER_RULE_JA).toContain('1km² あたり 1,000 人未満＝低密度')
    expect(CHARACTER_RULE_JA).toContain('従業者が人口以上＝業務地型')
    expect(CHARACTER_RULE_JA).toContain('昼間人口そのものではありません')
  })
})

// --- 災害（hazard.ts） -------------------------------------------------------

describe('災害の要約（事前計算・「安全」と言わない）', () => {
  it('事前計算が無い駅は null（＝分からない）', () => {
    expect(profileHazardOf(null)).toBeNull()
  })

  it('該当は重い順・「近く」は該当していない災害だけ・区域図なしは別に挙げる', () => {
    const hazard = profileHazardOf(HAZARD)
    expect(hazard?.level).toBe('warning')
    expect(hazard?.hitsJa).toEqual([
      '洪水：洪水浸水想定区域（想定最大規模）：0.5〜3m 未満',
      '津波：津波浸水想定：0〜0.3m 未満',
    ])
    expect(hazard?.nearbyJa).toEqual(['内水（雨水出水）']) // 洪水は該当しているので「近く」とは言わない
    expect(hazard?.uncoveredJa).toEqual(['土砂災害'])
  })

  it('限界（代表点 1 点・いま起きていることではない）と出典を必ず添える', () => {
    const hazard = profileHazardOf(HAZARD)
    expect(hazard?.caveatJa).toContain('駅の代表点 1 点')
    expect(hazard?.caveatJa).toContain('いま起きていることではありません')
    expect(hazard?.sources.length).toBeGreaterThan(0)
    expect(JSON.stringify(hazard)).not.toContain('安全です')
  })
})

// --- 組み立て（build.ts） ----------------------------------------------------

describe('組み立て（buildStationProfile）', () => {
  it('市内の比べ方：政令市の区は市全体、東京 23 区は区そのもの', () => {
    expect(comparisonAreaOf('横浜市西区')).toBe('横浜市')
    expect(comparisonAreaOf('千代田区')).toBe('千代田区')
    expect(comparisonAreaOf('府中市')).toBe('府中市')
    expect(comparisonAreaOf(null)).toBeNull()
    expect(comparisonAreaOf('')).toBeNull()
  })

  it('応答の形（共通 API の Zod を通る）・性格・凡例・見ていないこと・注記', () => {
    const profile = buildStationProfile(inputFor())
    expect(() => stationProfileSchema.parse(profile)).not.toThrow()
    expect(profile.character.kind).toBe('business')
    expect(profile.positionsLegendJa).toContain('市内＝横浜市')
    expect(profile.notCoveredJa).toEqual(PROFILE_NOT_COVERED_JA)
    expect(profile.notesJa.slice(0, 3)).toEqual([
      PROFILE_RANK_NOTE_JA,
      PROFILE_CIRCLE_NOTE_JA,
      CHARACTER_RULE_JA,
    ])
    expect(profile.notesJa).not.toContain(PROFILE_FLAG_NOTE_JA) // ⚠ が無ければ出さない
  })

  it('項目：値は単位つき・増減は符号つき・県内と市内の位置', () => {
    const profile = buildStationProfile(inputFor())
    const population = itemOf(profile, 'population')
    expect(population.valueJa).toBe('43,471 人')
    expect(population.periodJa).toBe('2020年')
    expect(population.positions.map((each) => each.labelJa)).toEqual([
      '神奈川県内 348 駅中 66 位（上位 19%）',
      '横浜市内 137 駅中 37 位（上位 28%）',
    ])
    expect(itemOf(profile, 'populationChange').valueJa).toBe('+5.3%')
    expect(itemOf(profile, 'landPrice').valueJa).toBe('1,735,000 円/㎡')
  })

  it('政令市の所得は市の平均が主なので、市内では比べない（県内だけ・注記で理由を言う）', () => {
    const income = itemOf(buildStationProfile(inputFor()), 'income')
    expect(income.positions.map((each) => each.scope)).toEqual(['prefecture'])
    expect(income.noteJa).toContain('市全体の平均が主')
    // 政令市でなければ市内でも比べ、注記は按分の説明になる
    const values = new Map(Object.entries({ ...VALUES_1KM, inc_city_only_1km: 0 }))
    const plain = itemOf(buildStationProfile(inputFor({ values })), 'income')
    expect(plain.positions.map((each) => each.scope)).toEqual(['prefecture', 'area'])
    expect(plain.noteJa).toContain('15〜64歳人口で按分')
  })

  it('読み方の注記：将来は推計、売上は調査の前の年の推計、乗降客数は半径によらない', () => {
    const profile = buildStationProfile(inputFor())
    expect(itemOf(profile, 'populationFuture').noteJa).toBe('国の推計で、実績ではありません。')
    expect(itemOf(profile, 'sales').noteJa).toContain('2021年調査＝2020年の売上の推計')
    const passengers = itemOf(profile, 'passengers')
    expect(passengers.radiusM).toBeNull()
    expect(passengers.noteJa).toBe('駅そのものの値で、半径によりません。')
  })

  it('500m 圏：地価の増減は 1km 圏に替え、そう書く。性格の目安は 1km 圏のまま', () => {
    const profile = buildStationProfile(inputFor({ radiusM: 500 }))
    const trend = itemOf(profile, 'landPriceChange')
    expect(trend.key).toBe('lp_gr_2026_2021_1km')
    expect(trend.radiusM).toBe(1000)
    expect(trend.noteJa).toBe('500m圏は算出対象外のため、1km圏の値です。')
    expect(itemOf(profile, 'population').valueJa).toBe('4,881 人')
    expect(profile.character.basisJa).toContain('179,031 人') // 1km 圏の従業者
  })

  it('⚠：カタログのフラグが立つ値は flagged、全体の注記に ⚠ の意味を足す', () => {
    const values = new Map(Object.entries({ ...VALUES_1KM, lp_lown_1km: 1 }))
    const profile = buildStationProfile(inputFor({ values }))
    expect(itemOf(profile, 'landPrice').flagged).toBe(true)
    expect(itemOf(profile, 'population').flagged).toBe(false)
    expect(profile.notesJa).toContain(PROFILE_FLAG_NOTE_JA)
  })

  it('値の無い指標は「—」で、位置も ⚠ も付けない（0 で埋めない）', () => {
    const values = new Map(Object.entries(VALUES_1KM).filter(([key]) => key !== 'bus_n_1km'))
    const bus = itemOf(buildStationProfile(inputFor({ values })), 'busStops')
    expect(bus.value).toBeNull()
    expect(bus.valueJa).toBe('—')
    expect(bus.positions).toEqual([])
    expect(bus.flagged).toBe(false)
  })

  it('市内で比べられる駅が少なければ（5 駅未満）、市内の位置を出さずにそう書く', () => {
    const sections = resolveProfileSections(1000)
    const profile = buildStationProfile(
      inputFor({
        station: { ...YOKOHAMA, prefecture: '東京都', municipality: '瑞穂町' },
        area: '瑞穂町',
        ranks: ranksFor(rankedKeys(sections), rank(300, 654, [1, 3])),
      }),
    )
    const positions = profile.sections.flatMap((section) =>
      section.items.flatMap((item) => item.positions),
    )
    expect(positions.every((each) => each.scope === 'prefecture')).toBe(true)
    expect(profile.notesJa.at(-1)).toBe(
      '瑞穂町内は比べられる駅が少ない（5 駅未満）ため、市内の位置は出していません。',
    )
  })

  it('市区町村が無ければ県内だけ（市内の注記も出さない）', () => {
    const profile = buildStationProfile(
      inputFor({ station: { ...YOKOHAMA, municipality: null }, area: null }),
    )
    expect(profile.positionsLegendJa).toBe(
      '位置は 県内＝神奈川県 の駅と比べたものです（値の大きい順・数字は順位/駅数）。',
    )
    expect(profile.notesJa.some((note) => note.includes('市内の位置は出していません'))).toBe(false)
  })

  it('出典：指標の出典は profile.sources、災害の出典は hazard.sources（分けて持つ）', () => {
    const profile = buildStationProfile(inputFor())
    const metricSources = profile.sources.map((each) => each.source)
    expect(metricSources.some((source) => source.includes('国勢調査'))).toBe(true)
    expect(new Set(metricSources).size).toBe(metricSources.length) // 重複なし
    const hazardSources = profile.hazard?.sources.map((each) => each.source) ?? []
    expect(hazardSources.length).toBeGreaterThan(0)
    expect(hazardSources.some((source) => metricSources.includes(source))).toBe(false)
  })

  it('災害の事前計算が無い駅は hazard: null（安全ではない＝分からない）', () => {
    expect(buildStationProfile(inputFor({ hazard: null })).hazard).toBeNull()
  })
})

// --- パネル（panel.ts） ------------------------------------------------------

describe('stationProfile パネル', () => {
  it('見出しは「横浜の周辺（1km圏）」・protocol の Zod を通る・出典は protocol の形に', () => {
    const profile = buildStationProfile(inputFor())
    const panel = stationProfilePanel(profile, 'compact')
    expect(panel.title).toBe('横浜の周辺（1km圏）')
    expect(panel.size).toBe('compact')
    expect(panel.sections).toBe(profile.sections) // 中身は応答そのもの
    expect(panel.sources[0]).toEqual({
      labelJa: profile.sources[0]?.source,
      url: null,
      license: profile.sources[0]?.license,
      forJa: null,
    })
    expect(() => panelSchema.parse(panel)).not.toThrow()
  })

  it('駅の呼び名に「駅」を足さない（「富山駅」という電停がある）', () => {
    const profile = buildStationProfile(
      inputFor({ station: { ...YOKOHAMA, label: '富山駅' }, radiusM: 2000 }),
    )
    expect(profileTitleOf(profile)).toBe('富山駅の周辺（2km圏）')
  })
})
