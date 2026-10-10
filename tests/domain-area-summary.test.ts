/**
 * エリアの要約（`src/domain/area-summary/`・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12）。
 *
 * 材料は本物の DB の応答を写した固定データ（`tests/fixtures/area-summary.ts`）。DB を使わずに固定するのは：
 * - **区域の値**：横浜市 2025 年 3,750,952 人・2020→2025 年 −0.7%（2015→2020 年は +1.4%）、推計の 2050 年と山と当たり具合
 *   （実績が推計より 0.9% 少ない）、川崎市は「多い」・山は 2045 年。山は途中の年だけ（ずっと減る・ずっと増えるなら無い）
 * - 作り方の名乗り：行政区域＝公表値（推計は市区町村ごとの合計）、沿線＝メッシュの按分、駅から N m＝駅の円の値
 * - 無い値：浜松市の新しい区（過去・推計・経済センサス）、浜通り（推計）、6 つ以外の半径・地図の範囲（区域の値ごと）
 * - **駅の分布**：中央値・中ほどの半分・上位と下位（少ない駅で同じ駅を両方に出さない）・⚠ と値なしの数・半径を替えた注記。
 *   駅の無いエリアは分布を空にする
 * - 内訳：区は増減の大きい順（西区 +3.1% … 金沢区 −3.4%）、東京 23 区は 23 の区、沿線は路線の駅の順
 * - 比較：全員にそろう年（沿線が入ると 2020 年まで）・2020 年＝100 の指数（実績・推計それぞれの 2020 年）
 * - 注記と出典、色分けしなかったら地図の条件を送らない
 * - パネル：要約・推移・内訳の 3 つまで（比較は内訳なし・凡例つきの指数）。どれも GUI Chat Protocol の型を通る
 */

import { describe, expect, it } from 'vitest'
import { type LineStation, type StationStatRow } from '@/db/queries'
import {
  areaSummaryResponseSchema,
  areasResponseSchema,
  type AreaSummary,
  type AreaTotal,
} from '@/shared/area-summary'
import { getAreaMetric } from '@/shared/area-catalog'
import { requireEntry } from '@/shared/catalog'
import { type RadiusM } from '@/shared/constants'
import { panelSchema } from '@/shared/protocol'
import { classifyStations } from '@/domain/style/classify'
import { areaSeriesColor } from '@/domain/style/palette'
import { defaultColorEntry } from '@/domain/style/load'
import { changeOf, rateJa, rateOf, valueJa } from '@/domain/area-summary/wording'
import { accuracyOf, buildTotals, peakOf, type MethodOf } from '@/domain/area-summary/totals'
import { resolveStationStats, stationStatOf } from '@/domain/area-summary/stations'
import { adminBreakdown, childrenOf, lineBreakdown } from '@/domain/area-summary/breakdown'
import { compareAreas, INDEX_BASE_YEAR } from '@/domain/area-summary/compare'
import {
  AREA_NOT_INCLUDED_JA,
  AREA_TOTALS_NOTE_JA,
  notesFor,
  PROJECTION_NOTE_JA,
  sourcesFor,
  stationsNote,
  YEAR_GAP_NOTE_JA,
} from '@/domain/area-summary/notes'
import {
  BBOX_UNAVAILABLE_JA,
  buildAreaSummary,
  buildAreaSummaryResponse,
  circleAreaKm2,
  MESH_UNAVAILABLE_JA,
  missingText,
  nearUnavailableJa,
  stationKeyOf,
  type AreaSummaryParts,
} from '@/domain/area-summary/build'
import { stationFilterOf, type ResolvedArea } from '@/domain/area-summary/resolve'
import {
  areaSummaryPanels,
  areaSummaryTitleOf,
  BREAKDOWN_EDGE_BARS,
  breakdownBarRows,
  MAX_BREAKDOWN_BARS,
} from '@/domain/area-summary/panel'
import { areasResponseOf } from '@/domain/area-summary/catalog'
import {
  HAMAMATSU_ROWS,
  IWAKI_ROWS,
  KAWASAKI_ROWS,
  MONBETSU_ROWS,
  TAKEBASHI,
  TAKEBASHI_5KM,
  TOKYO23_ROWS,
  TOYOKO_ROWS,
  YOKOHAMA_POP_GR,
  YOKOHAMA_ROWS,
  YOKOHAMA_STATION_STATS,
} from './fixtures/area-summary'

const RADIUS: RadiusM = 1000
const STATS = resolveStationStats(RADIUS, defaultColorEntry(RADIUS))

function first<T>(items: readonly T[]): T {
  const item = items[0]
  if (item === undefined) throw new Error('空の並び')
  return item
}

function admin(rows: readonly (typeof YOKOHAMA_ROWS)[number][]): ResolvedArea {
  const row = first(rows)
  return { type: 'admin', ref: row.key, row, children: rows.slice(1) }
}

function line(): ResolvedArea {
  const row = first(TOYOKO_ROWS)
  return { type: 'line', ref: row.key, row }
}

function near(withinM: number): ResolvedArea {
  return { type: 'near', ref: `near:竹橋#0@${withinM}`, origin: TAKEBASHI, withinM }
}

/** 駅の円の値（`station_bundle`）→ 区域の指標の key（`load.ts` の circleParts と同じ写し方）。 */
function circleOf(bundle: Readonly<Record<string, number>>, suffix: string): Map<string, number> {
  return new Map(
    Object.entries(bundle)
      .map(([key, value]): [string, number] => [key.replace(suffix, ''), value])
      .filter(
        ([key]) => getAreaMetric(key)?.sources.line !== null && getAreaMetric(key) !== undefined,
      ),
  )
}

function parts(area: ResolvedArea, overrides: Partial<AreaSummaryParts> = {}): AreaSummaryParts {
  return { area, stationCount: 0, statRows: [], line: null, circle: null, ...overrides }
}

const YOKOHAMA_PARTS = parts(admin(YOKOHAMA_ROWS), {
  stationCount: YOKOHAMA_STATION_STATS.stationCount,
  statRows: YOKOHAMA_STATION_STATS.stats,
})

function totalOf(summary: AreaSummary, id: AreaTotal['id']): AreaTotal {
  const total = summary.totals.find((each) => each.id === id)
  if (total === undefined) throw new Error(`区域の値がありません: ${id}`)
  return total
}

/** 行政区域の作り方（`build.ts` と同じ：カタログの admin）。 */
const adminMethod: MethodOf = (metric) => ({
  method: metric.sources.admin.method,
  sourceJa: metric.sources.admin.sourceJa,
})

// --- 言い方 ------------------------------------------------------------------------------

describe('数の言い方', () => {
  it('値は単位つきの整数（推計の端数は四捨五入）', () => {
    expect(valueJa(3750952, '人')).toBe('3,750,952 人')
    expect(valueJa(3537252.9986, '人')).toBe('3,537,253 人')
    expect(valueJa(116479, '事業所')).toBe('116,479 事業所')
  })

  it('増減は符号つき小数 1 桁。起点が 0 以下なら率にしない', () => {
    expect(rateOf(3777491, 3750952)).toBeCloseTo(-0.7026, 4)
    expect(rateJa(-0.7025)).toBe('-0.7%')
    expect(rateJa(1.41)).toBe('+1.4%')
    expect(rateOf(0, 5)).toBeNull()
    expect(rateOf(-1, 5)).toBeNull()
  })

  it('2 つの点の増減（「2020→2025年で -0.7%」）', () => {
    const change = changeOf(
      { year: 2020, value: 3777491, kind: 'actual' },
      { year: 2025, value: 3750952, kind: 'actual' },
    )
    expect(change).toMatchObject({
      fromYear: 2020,
      toYear: 2025,
      rateJa: '-0.7%',
      textJa: '2020→2025年で -0.7%',
    })
    expect(
      changeOf({ year: 2020, value: 0, kind: 'actual' }, { year: 2025, value: 1, kind: 'actual' }),
    ).toBeNull()
  })
})

// --- 区域の値 -----------------------------------------------------------------------------

describe('区域の値（行政区域は公表値）', () => {
  const summary = buildAreaSummary(YOKOHAMA_PARTS, STATS, RADIUS)

  it('人口：最新の 2025 年と 2020→2025 年の増減、その前の 2015→2020 年も添える', () => {
    const population = totalOf(summary, 'population')
    expect(population.headlineJa).toBe(
      '3,750,952 人（2025年）・2020→2025年で -0.7%（2015→2020年は +1.4%）',
    )
    expect(population.method).toBe('official')
    expect(population.methodJa).toBe('公表値')
    expect(population.points.map((point) => point.year)).toEqual([
      1995, 2000, 2005, 2010, 2015, 2020, 2025,
    ])
    expect(population.points.every((point) => point.kind === 'actual')).toBe(true)
    // 2025 年は令和 7 年国勢調査、それより前は組み替え済みの時系列（出典を年ごとに名乗る）
    expect(population.sourceJa).toContain('／')
    expect(population.sourceJa).toContain('令和7年国勢調査')
  })

  it('将来推計人口：2050 年と推計の 2020 年からの増減、山（2025 年）と推計の当たり具合', () => {
    const future = totalOf(summary, 'populationFuture')
    expect(future.headlineJa).toBe('2050年 3,537,253 人（推計・2020年比 -6.4%）')
    expect(future.changes.map((change) => change.textJa)).toEqual([
      '2020→2050年で -6.4%',
      '2020→2070年で -16.6%',
    ])
    expect(future.peak).toEqual({ year: 2025, value: 3786701.9999, valueJa: '3,786,702 人' })
    expect(future.accuracy?.textJa).toBe('2025年の実績は推計より 0.9% 少ない')
    expect(future.method).toBe('projection')
    expect(future.methodJa).toBe('推計（市区町村ごとの合計）')
    expect(future.points.every((point) => point.kind === 'projection')).toBe(true)
  })

  it('事業所・従業者（民営）：2021 年と 2016→2021 年、2012→2021 年', () => {
    expect(totalOf(summary, 'establishments').headlineJa).toBe(
      '116,479 事業所（2021年）・2016→2021年で +1.3%',
    )
    expect(totalOf(summary, 'establishments').changes.map((change) => change.textJa)).toEqual([
      '2016→2021年で +1.3%',
      '2012→2021年で +1.8%',
    ])
    expect(totalOf(summary, 'employees').headlineJa).toBe(
      '1,527,783 人（2021年）・2016→2021年で +3.5%',
    )
  })

  it('川崎市は実績が推計より多く、推計の山は 2045 年', () => {
    const kawasaki = buildAreaSummary(parts(admin(KAWASAKI_ROWS)), STATS, RADIUS)
    expect(totalOf(kawasaki, 'population').headlineJa).toBe(
      '1,559,571 人（2025年）・2020→2025年で +1.4%（2015→2020年は +4.3%）',
    )
    const future = totalOf(kawasaki, 'populationFuture')
    expect(future.accuracy?.textJa).toBe('2025年の実績は推計より 1.6% 多い')
    expect(future.peak?.year).toBe(2045)
    expect(future.headlineJa).toBe('2050年 1,605,531 人（推計・2020年比 +4.4%）')
  })

  it('山は途中の年だけ（ずっと減る・ずっと増える系列には無い）', () => {
    const points = (values: readonly number[]) =>
      values.map((value, index) => ({ year: 2020 + index * 5, value, kind: 'projection' as const }))
    expect(peakOf(points([10, 9, 8]), '人')).toBeNull()
    expect(peakOf(points([8, 9, 10]), '人')).toBeNull()
    expect(peakOf(points([8, 10, 9]), '人')).toEqual({ year: 2025, value: 10, valueJa: '10 人' })
    expect(peakOf([], '人')).toBeNull()
    const monbetsu = buildAreaSummary(parts(admin(MONBETSU_ROWS)), STATS, RADIUS)
    expect(totalOf(monbetsu, 'populationFuture').peak).toBeNull()
  })

  it('推計の当たり具合：差が 0.05% 未満なら「ほぼ同じ」・無ければ null', () => {
    const values = (actual: number, projected: number) =>
      new Map([
        ['pop_2025', actual],
        ['pop_pred_2024_2025', projected],
      ])
    expect(accuracyOf(values(100000, 100040))?.textJa).toBe('2025年の実績は推計とほぼ同じ')
    expect(accuracyOf(values(99000, 100000))?.textJa).toBe('2025年の実績は推計より 1.0% 少ない')
    expect(accuracyOf(new Map([['pop_2025', 1]]))).toBeNull()
  })

  it('値の無い系統は出さない（いわき市は推計なし・浜松市中央区は人口の 2020・2025 年だけ）', () => {
    const iwaki = buildAreaSummary(parts(admin(IWAKI_ROWS)), STATS, RADIUS)
    expect(iwaki.totals.map((total) => total.id)).toEqual([
      'population',
      'establishments',
      'employees',
    ])
    const chuo = HAMAMATSU_ROWS.find((row) => row.key === 'muni:22138')
    if (chuo === undefined) throw new Error('浜松市中央区が無い')
    const ward = buildTotals(chuo.values, adminMethod, true)
    expect(ward.map((total) => total.id)).toEqual(['population'])
    expect(first(ward).headlineJa).toBe('591,034 人（2025年）・2020→2025年で -2.8%')
  })
})

describe('沿線と駅から N m の区域の値（作り方を名乗る）', () => {
  it('沿線はメッシュの按分。人口の実績は 2015・2020 年、推計の当たり具合は無い（2025 年のメッシュが無い）', () => {
    const summary = buildAreaSummary(parts(line(), { stationCount: 21 }), STATS, RADIUS)
    const future = totalOf(summary, 'populationFuture')
    expect(future.headlineJa).toBe('2050年 787,122 人（推計・2020年比 +4.9%）')
    expect(future.method).toBe('mesh')
    expect(future.methodJa).toBe('メッシュの按分')
    expect(future.accuracy).toBeNull()
    expect(totalOf(summary, 'population').points.map((point) => point.year)).toEqual([2015, 2020])
    expect(summary.unavailableJa).toEqual([MESH_UNAVAILABLE_JA])
    expect(summary).toMatchObject({
      kind: 'line',
      kindJa: '沿線',
      nameJa: '東急東横線',
      parent: null,
    })
  })

  it('駅から 5km は起点の駅の円の値（駅詳細と同じ値・1995〜2010 年は使わない）', () => {
    const summary = buildAreaSummary(
      parts(near(5000), { stationCount: 129, circle: circleOf(TAKEBASHI_5KM, '_5km') }),
      STATS,
      RADIUS,
    )
    const population = totalOf(summary, 'population')
    expect(population.headlineJa).toBe('1,277,680 人（2020年）・2015→2020年で +9.8%')
    expect(population.points.map((point) => point.year)).toEqual([2015, 2020])
    expect(population.method).toBe('stationRadius')
    expect(population.methodJa).toBe('駅の円の値（メッシュの按分）')
    expect(population.sourceJa).toBe(requireEntry('pop_2020_5km').source)
    expect(totalOf(summary, 'employees').headlineJa).toBe(
      '3,702,211 人（2021年）・2016→2021年で +10.0%',
    )
    expect(totalOf(summary, 'populationFuture').peak?.year).toBe(2050)
    expect(summary).toMatchObject({
      kind: 'near',
      kindJa: '駅から 5km の円',
      nameJa: '竹橋から 5km',
      areaKm2: 78.54,
      unavailableJa: [MESH_UNAVAILABLE_JA],
    })
  })

  it('6 つ以外の半径（3km）は区域の値を出さず、出せる半径を返す', () => {
    const summary = buildAreaSummary(parts(near(3000), { stationCount: 70 }), STATS, RADIUS)
    expect(summary.totals).toEqual([])
    expect(summary.unavailableJa).toEqual([nearUnavailableJa(3000)])
    expect(nearUnavailableJa(3000)).toBe(
      '駅から 3km の区域の値は出していない（出せる半径：500m・1km・2km・5km・10km・20km）。駅の分布と色分けは出している。',
    )
  })

  it('地図の範囲は区域の値を出さない（面積も無い）', () => {
    const bbox = { west: 139.55, south: 35.4, east: 139.72, north: 35.53 }
    const summary = buildAreaSummary(
      parts({ type: 'bbox', ref: 'bbox:139.55,35.4,139.72,35.53', bbox }, { stationCount: 79 }),
      STATS,
      RADIUS,
    )
    expect(summary).toMatchObject({
      kind: 'bbox',
      totals: [],
      areaKm2: null,
      unavailableJa: [BBOX_UNAVAILABLE_JA],
    })
  })

  it('円の面積は 0.01 km² に丸める', () => {
    expect(circleAreaKm2(5000)).toBe(78.54)
    expect(circleAreaKm2(1000)).toBe(3.14)
    expect(circleAreaKm2(500)).toBe(0.79)
  })

  it('区域の指標 → 駅の指標の key', () => {
    const metric = getAreaMetric('pop_pred_2024_2050')
    if (metric === undefined) throw new Error('指標が無い')
    expect(stationKeyOf(metric, 5000)).toBe('pop_pred_2024_2050_5km')
    expect(requireEntry(stationKeyOf(metric, 500)).key).toBe('pop_pred_2024_2050_500m')
  })
})

describe('無い値の理由', () => {
  it('浜松市の新しい区：人口の過去・推計・経済センサスの理由を、指標と年つきで', () => {
    const chuo = HAMAMATSU_ROWS.find((row) => row.key === 'muni:22138')
    if (chuo === undefined) throw new Error('浜松市中央区が無い')
    expect(chuo.missing.map(missingText)).toEqual([
      expect.stringMatching(/^人口（1995〜2015年）：2024 年 1 月の区の再編/),
      expect.stringMatching(/^将来推計人口（2020〜2070年）：/),
      expect.stringMatching(/^事業所（2012〜2021年）・従業者（2012〜2021年）：/),
    ])
  })

  it('浜通り：将来推計人口の理由', () => {
    const iwaki = buildAreaSummary(parts(admin(IWAKI_ROWS)), STATS, RADIUS)
    expect(iwaki.unavailableJa).toEqual([
      '将来推計人口（2020〜2070年）：社人研は福島県の浜通り 13 市町村の個別の推計を出していない（13 市町村をまとめた値だけ）',
    ])
  })
})

// --- 駅の分布 -----------------------------------------------------------------------------

describe('駅の分布（エリアの駅ごとの円の値・エリア全体の値ではない）', () => {
  it('既定は人口・人口の増減（5 年）・将来の増減（2050 年）・地価・従業者（その半径）', () => {
    expect(STATS.map((stat) => stat.entry.key)).toEqual([
      'pop_2020_1km',
      'pop_gr_2020_2015_1km',
      'pop_gr_pred_2024_2050_1km',
      'lp_med_2026_1km',
      'emp_n_2021_1km',
    ])
  })

  it('色分けの指標がほかにあれば最後に足す（同じなら足さない）', () => {
    const pax = requireEntry('pax_2024')
    expect(
      resolveStationStats(RADIUS, pax)
        .map((stat) => stat.entry.key)
        .at(-1),
    ).toBe('pax_2024')
    expect(resolveStationStats(RADIUS, requireEntry('pop_2020_1km'))).toHaveLength(5)
  })

  it('半径の無い指標は近い半径に替え、そう書く（地価は 20km が無い → 10km）', () => {
    const lp = resolveStationStats(20000, null).find((stat) => stat.entry.key.startsWith('lp_med'))
    if (lp === undefined) throw new Error('地価が無い')
    expect(lp.entry.key).toBe('lp_med_2026_10km')
    expect(lp.substituted).toBe(true)
    expect(stationStatOf(lp, undefined, 0, 20000).noteJa).toBe(
      '20km圏は算出対象外のため、10km圏の値です。',
    )
    const pop = resolveStationStats(20000, null).find((stat) =>
      stat.entry.key.startsWith('pop_2020'),
    )
    expect(pop?.substituted).toBe(false)
  })

  it('横浜市の 137 駅：中央値・中ほどの半分・上位と下位・⚠ と値なし', () => {
    const summary = buildAreaSummary(YOKOHAMA_PARTS, STATS, RADIUS)
    const [pop, growth, , landPrice] = summary.stations.stats
    expect(pop).toMatchObject({
      labelJa: '人口',
      periodJa: '2020年',
      n: 137,
      missingN: 0,
      medianJa: '34,581 人',
      rangeJa: '25,164〜44,957 人',
    })
    expect(pop?.top.map((each) => `${each.labelJa} ${each.valueJa}`)).toEqual([
      '阪東橋 72,082 人',
      '黄金町 70,494 人',
      '伊勢佐木長者町 66,951 人',
    ])
    expect(growth).toMatchObject({
      n: 136,
      missingN: 1,
      medianJa: '+2.5%',
      rangeJa: '+0.2%〜+4.9%',
    })
    expect(landPrice).toMatchObject({ n: 94, flaggedN: 40, missingN: 3, medianJa: '357,000 円/㎡' })
    expect(summary.stations).toMatchObject({ count: 137, radiusM: 1000 })
  })

  it('駅が少なく上位と下位が重なるときは、下位から上位の駅を外す。中ほどの半分が 1 つの値なら 1 つだけ書く', () => {
    const entry = requireEntry('lp_med_2026_1km')
    const stat = { entry, labelJa: '地価（中央値）', substituted: false }
    const station = (grp: string, value: number) => ({ grp, label: grp, value })
    const row: StationStatRow = {
      key: entry.key,
      n: 1,
      flaggedN: 9,
      q1: 61700,
      median: 61700,
      q3: 61700,
      top: [station('いわき', 61700)],
      bottom: [station('いわき', 61700)],
    }
    const result = stationStatOf(stat, row, 14, RADIUS)
    expect(result.bottom).toEqual([])
    expect(result.rangeJa).toBe('61,700 円/㎡')
    expect(result.missingN).toBe(4)
  })

  it('駅の無いエリアは分布を空にする（値 0 の行を並べない）・注記も付けない', () => {
    const summary = buildAreaSummary(parts(admin(MONBETSU_ROWS)), STATS, RADIUS)
    expect(summary.stations).toEqual({ count: 0, radiusM: 1000, stats: [] })
    expect(notesFor([summary], RADIUS)).not.toContain(stationsNote(RADIUS))
  })
})

// --- 内訳 -----------------------------------------------------------------------------------

describe('内訳', () => {
  it('政令市は区：増減の大きい順（西区 +3.1% … 金沢区 −3.4%）・区の名前は短く', () => {
    const breakdown = buildAreaSummary(YOKOHAMA_PARTS, STATS, RADIUS).breakdown
    expect(breakdown).toMatchObject({
      byJa: '区',
      valueLabelJa: '人口（2025年）',
      changeLabelJa: '増減（2020→2025年）',
      futureLabelJa: '将来（2020→2050年・推計）',
      noteJa: null,
    })
    const rows = breakdown?.rows ?? []
    expect(rows).toHaveLength(18)
    expect(rows.slice(0, 4).map((row) => `${row.nameJa} ${row.changeJa}`)).toEqual([
      '西区 +3.1%',
      '中区 +2.2%',
      '神奈川区 +2.0%',
      '港北区 +1.4%',
    ])
    expect(rows.at(-1)).toMatchObject({
      ref: 'muni:14108',
      nameJa: '金沢区',
      valueJa: '192,098 人',
      changeJa: '-3.4%',
      futureJa: '-23.6%',
      stationCount: 17,
    })
    expect(rows.filter((row) => (row.change ?? 0) > 0)).toHaveLength(6)
  })

  it('東京 23 区は束ねた 23 の区', () => {
    const area = admin(TOKYO23_ROWS)
    const breakdown = area.type === 'admin' ? adminBreakdown(area.row, area.children) : null
    expect(breakdown?.rows).toHaveLength(23)
    expect(breakdown?.rows[0]).toMatchObject({ nameJa: '台東区', changeJa: '+7.9%' })
    expect(childrenOf(first(TOKYO23_ROWS), TOKYO23_ROWS)).toHaveLength(23)
  })

  it('浜松市：新しい区は将来の値が無く、そう注記する', () => {
    const area = admin(HAMAMATSU_ROWS)
    const breakdown = area.type === 'admin' ? adminBreakdown(area.row, area.children) : null
    expect(breakdown?.rows.map((row) => `${row.nameJa} ${row.changeJa} ${row.futureJa}`)).toEqual([
      '中央区 -2.8% —',
      '浜名区 -3.5% —',
      '天竜区 -11.5% -56.8%',
    ])
    expect(breakdown?.noteJa).toBe('将来の値が無い区域がある（理由はその区域の「無い値」）。')
  })

  it('子の無い区域（市町村・区）は内訳なし', () => {
    expect(buildAreaSummary(parts(admin(KAWASAKI_ROWS)), STATS, RADIUS).breakdown).toBeNull()
    expect(buildAreaSummary(parts(admin(IWAKI_ROWS)), STATS, RADIUS).breakdown).toBeNull()
  })

  it('沿線は駅（路線の順）・駅ごとの円の値（足せないと書く）', () => {
    const stations: LineStation[] = [
      { seq: 3, grp: '中目黒#0', label: '中目黒' },
      { seq: 1, grp: '渋谷#0', label: '渋谷' },
      { seq: 2, grp: '代官山#0', label: '代官山' },
    ]
    const values = {
      '渋谷#0': { pop_2020_1km: 31640, pop_gr_2020_2015_1km: 7.2, pop_gr_pred_2024_2050_1km: -1.6 },
      '代官山#0': { pop_2020_1km: 52529, pop_gr_2020_2015_1km: 5.7 },
    }
    const breakdown = lineBreakdown(1000, stations, values)
    expect(
      breakdown.rows.map((row) => `${row.nameJa} ${row.valueJa} ${row.changeJa} ${row.futureJa}`),
    ).toEqual(['渋谷 31,640 人 +7.2% -1.6%', '代官山 52,529 人 +5.7% —', '中目黒 — — —'])
    expect(breakdown).toMatchObject({
      byJa: '駅（路線の順）',
      valueLabelJa: '駅から 1km の人口（2020年）',
      changeLabelJa: '増減（2015→2020年）',
    })
    expect(breakdown.noteJa).toContain('円が重なるので、足しても沿線の値にならない')
    expect(breakdown.rows.every((row) => row.ref === null && row.stationCount === null)).toBe(true)
  })
})

// --- 比較 -----------------------------------------------------------------------------------

describe('比較（2〜4 つ）', () => {
  const yokohama = buildAreaSummary(YOKOHAMA_PARTS, STATS, RADIUS)
  const kawasaki = buildAreaSummary(
    parts(admin(KAWASAKI_ROWS), { stationCount: 53 }),
    STATS,
    RADIUS,
  )
  const toyoko = buildAreaSummary(parts(line(), { stationCount: 21 }), STATS, RADIUS)

  it('1 つなら比較しない', () => {
    expect(compareAreas([yokohama])).toBeNull()
  })

  it('横浜市と川崎市：2025 年でそろえ、推計・従業者・駅の数・作り方を並べる', () => {
    const comparison = compareAreas([yokohama, kawasaki])
    expect(comparison?.names).toEqual(['神奈川県横浜市', '神奈川県川崎市'])
    expect(comparison?.rows.map((row) => [row.labelJa, ...row.cells])).toEqual([
      ['人口（2025年）', '3,750,952 人', '1,559,571 人'],
      ['人口の増減（2020→2025年）', '-0.7%', '+1.4%'],
      ['将来推計人口（2050年）', '3,537,253 人', '1,605,531 人'],
      ['将来の増減（2020→2050年・推計）', '-6.4%', '+4.4%'],
      ['従業者（民営）', '1,527,783 人（2021年）', '547,471 人（2021年）'],
      ['駅の数', '137 駅', '53 駅'],
      ['区域の値の作り方', '公表値', '公表値'],
    ])
    expect(comparison?.notesJa).toEqual([
      '推移は 2020年を 100 とした指数（実績は実績の 2020年、推計は推計の 2020年を 100）。',
    ])
  })

  it('指数：実績は実績の 2020 年、推計は推計の 2020 年を 100 にする', () => {
    const comparison = compareAreas([yokohama, kawasaki])
    const index = comparison?.index[0]?.points ?? []
    const at = (year: number, kind: 'actual' | 'projection') =>
      index.find((point) => point.year === year && point.kind === kind)?.value
    expect(comparison?.baseYear).toBe(INDEX_BASE_YEAR)
    expect(at(2020, 'actual')).toBe(100)
    expect(at(2020, 'projection')).toBe(100)
    expect(at(2025, 'actual')).toBeCloseTo(99.3, 1)
    expect(at(2050, 'projection')).toBeCloseTo(93.6, 1)
  })

  it('沿線が入ると人口は全員にそろう 2020 年まで・作り方が違うと注記する', () => {
    const comparison = compareAreas([yokohama, toyoko])
    expect(comparison?.rows.slice(0, 2).map((row) => [row.labelJa, ...row.cells])).toEqual([
      ['人口（2020年）', '3,777,491 人', '760,069 人'],
      ['人口の増減（2015→2020年）', '+1.4%', '+5.3%'],
    ])
    expect(comparison?.rows.at(-1)?.cells).toEqual(['公表値', 'メッシュの按分'])
    expect(comparison?.notesJa).toEqual([
      '人口は全員にそろう年（2020年まで）で比べた（沿線・駅の円の値は 2020 年まで）。',
      '推移は 2020年を 100 とした指数（実績は実績の 2020年、推計は推計の 2020年を 100）。',
      '区域の値の作り方がエリアで違う（行の「区域の値の作り方」）。',
    ])
    // 沿線の実績の指数は 2015・2020 年だけ（そろう年）
    expect(
      comparison?.index[0]?.points
        .filter((point) => point.kind === 'actual')
        .map((point) => point.year),
    ).toEqual([2015, 2020])
  })

  it('区域の値の無いエリア（地図の範囲）は「—」と「なし（駅の分布だけ）」', () => {
    const bbox = buildAreaSummary(
      parts({
        type: 'bbox',
        ref: 'bbox:139.55,35.4,139.72,35.53',
        bbox: { west: 139.55, south: 35.4, east: 139.72, north: 35.53 },
      }),
      STATS,
      RADIUS,
    )
    const comparison = compareAreas([yokohama, bbox])
    expect(comparison?.rows.find((row) => row.labelJa === '将来推計人口（2050年）')?.cells).toEqual(
      ['3,537,253 人', '—'],
    )
    expect(comparison?.rows.at(-1)?.cells).toEqual(['公表値', 'なし（駅の分布だけ）'])
    expect(comparison?.index[1]?.points).toEqual([])
  })
})

// --- 注記・出典・応答 ---------------------------------------------------------------------------

describe('注記・見ていないこと・出典', () => {
  it('区域の値・推計・年のずれ・駅の分布の注記（あるものだけ）', () => {
    const yokohama = buildAreaSummary(YOKOHAMA_PARTS, STATS, RADIUS)
    expect(notesFor([yokohama], RADIUS)).toEqual([
      AREA_TOTALS_NOTE_JA,
      PROJECTION_NOTE_JA,
      YEAR_GAP_NOTE_JA,
      stationsNote(RADIUS),
    ])
    const nearOdd = buildAreaSummary(
      parts(near(3000), { stationCount: 70, statRows: YOKOHAMA_STATION_STATS.stats }),
      STATS,
      RADIUS,
    )
    expect(notesFor([nearOdd], RADIUS)).toEqual([stationsNote(RADIUS)])
    expect(stationsNote(2000)).toContain('駅ごとの 2km の円の値')
  })

  it('出典は (出典, 利用条件) で束ねる（初出順）', () => {
    const yokohama = buildAreaSummary(YOKOHAMA_PARTS, STATS, RADIUS)
    const sources = sourcesFor(
      [yokohama, yokohama],
      [
        { source: 'A', license: 'x' },
        { source: 'A', license: 'x' },
        { source: 'A', license: 'y' },
      ],
    )
    expect(sources.slice(0, 2)).toEqual([
      { source: 'A', license: 'x' },
      { source: 'A', license: 'y' },
    ])
    const keys = sources.map((each) => `${each.source}\u0000${each.license}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('応答：共通 API の形を通り、色分けの条件は凡例と同じ指標・エリア', () => {
    const entry = requireEntry('pop_gr_2020_2015_1km')
    const values = YOKOHAMA_POP_GR.flatMap((each) =>
      each.value === null ? [] : [{ grp: each.grp, value: each.value, flagged: each.flagged }],
    )
    const { legend } = classifyStations(values, entry, YOKOHAMA_POP_GR.length)
    const response = areaSummaryResponseSchema.parse(
      buildAreaSummaryResponse([YOKOHAMA_PARTS], STATS, RADIUS, legend),
    )
    expect(response.coloring).toEqual({ metricKey: 'pop_gr_2020_2015_1km', areas: ['muni:14100'] })
    expect(response.comparison).toBeNull()
    expect(response.notIncludedJa).toEqual([...AREA_NOT_INCLUDED_JA])
    expect(response.sources.length).toBeGreaterThan(3)
  })

  it('色分けしなかった（駅が少ない）ら、地図の条件は null・凡例は理由を持って残る', () => {
    const entry = requireEntry('pop_2020_1km')
    const { legend } = classifyStations([], entry, 0)
    const response = buildAreaSummaryResponse([parts(admin(MONBETSU_ROWS))], STATS, RADIUS, legend)
    expect(response.coloring).toBeNull()
    expect(response.legend?.reasonJa).toBe('値のある駅が 0 しかないので色分けしない（5 駅から）。')
  })

  it('色分けを求めていなければ（none）条件も凡例も null', () => {
    const response = buildAreaSummaryResponse([YOKOHAMA_PARTS], STATS, RADIUS, null)
    expect(response.coloring).toBeNull()
    expect(response.legend).toBeNull()
  })
})

describe('エリア → 駅の絞り込み', () => {
  it('行政区域・沿線・駅から N m・範囲', () => {
    expect(stationFilterOf(admin(YOKOHAMA_ROWS))).toEqual({ municipality: '横浜市' })
    expect(stationFilterOf(admin(TOKYO23_ROWS))).toEqual({ municipality: '131' })
    expect(stationFilterOf(line())).toEqual({ lines: [26001] })
    expect(stationFilterOf(near(5000))).toEqual({
      near: { lon: TAKEBASHI.lon, lat: TAKEBASHI.lat, radiusM: 5000 },
    })
    const bbox = { west: 139.55, south: 35.4, east: 139.72, north: 35.53 }
    expect(stationFilterOf({ type: 'bbox', ref: 'bbox:x', bbox })).toEqual({ bbox })
  })
})

// --- パネル ---------------------------------------------------------------------------------

describe('パネル（要約・推移・内訳の 3 つまで）', () => {
  const single = buildAreaSummaryResponse([YOKOHAMA_PARTS], STATS, RADIUS, null)
  const compared = buildAreaSummaryResponse(
    [YOKOHAMA_PARTS, parts(admin(KAWASAKI_ROWS), { stationCount: 53 })],
    STATS,
    RADIUS,
    null,
  )

  it('1 つ：要約・人口の推移（実績＝実線・推計＝破線・同じ色）・区ごとの増減', () => {
    const panels = areaSummaryPanels(single, 'compact')
    expect(panels.map((panel) => panel.type)).toEqual(['areaSummary', 'trendChart', 'barChart'])
    panels.forEach((panel) => panelSchema.parse(panel))
    const [summary, trend, bars] = panels
    expect(summary?.type === 'areaSummary' && summary.title).toBe('神奈川県横浜市の要約')
    if (trend?.type !== 'trendChart' || bars?.type !== 'barChart') throw new Error('型が違う')
    expect(trend.title).toBe('神奈川県横浜市の人口の推移（実績・将来推計）')
    expect(
      trend.series.map((series) => [series.label, series.dashed === true, series.color]),
    ).toEqual([
      ['実績', false, trend.series[0]?.color],
      ['R6推計', true, trend.series[0]?.color],
    ])
    expect(trend.stats).toEqual([
      { label: '2020→2025年', value: '-0.7%', flagged: false },
      { label: '2020→2050年（推計）', value: '-6.4%', flagged: false },
    ])
    expect(trend.legend).toBeUndefined()
    expect(bars.title).toBe('横浜市の区ごとの人口の増減（2020→2025年）')
    expect(bars.bars).toHaveLength(18)
    expect(bars.bars[0]).toEqual({
      label: '西区',
      value: expect.any(Number),
      formatted: '+3.1%',
      flagged: false,
    })
    expect(bars.size).toBe('compact')
  })

  it('要約のパネルは図に回すもの（年ごとの値・内訳の行・指数）を持たない', () => {
    const [summary] = areaSummaryPanels(single)
    if (summary?.type !== 'areaSummary') throw new Error('型が違う')
    const card = first(summary.areas)
    expect('breakdown' in card).toBe(false)
    expect(card.totals.every((total) => !('points' in total))).toBe(true)
    expect(card.totals[1]?.accuracy?.textJa).toBe('2025年の実績は推計より 0.9% 少ない')
    expect(summary.notIncludedJa).toEqual([...AREA_NOT_INCLUDED_JA])
    expect(summary.sources.every((source) => source.url === null && source.forJa === null)).toBe(
      true,
    )
  })

  it('比較：要約（比べる表つき）と、2020 年＝100 の指数（エリアごとの色・凡例つき）。内訳は出さない', () => {
    const panels = areaSummaryPanels(compared)
    expect(panels.map((panel) => panel.type)).toEqual(['areaSummary', 'trendChart'])
    panels.forEach((panel) => panelSchema.parse(panel))
    const [summary, trend] = panels
    expect(summary?.type === 'areaSummary' && summary.title).toBe('横浜市・川崎市の比較')
    expect(summary?.type === 'areaSummary' && 'index' in (summary.comparison ?? {})).toBe(false)
    if (trend?.type !== 'trendChart') throw new Error('型が違う')
    expect(trend.title).toBe('人口の推移（2020年＝100）')
    expect(trend.legend).toBe(true)
    expect(trend.flags).toEqual([])
    expect(
      trend.series.map((series) => [series.label, series.dashed === true, series.color]),
    ).toEqual([
      ['神奈川県横浜市', false, areaSeriesColor(0)],
      ['神奈川県横浜市（推計）', true, areaSeriesColor(0)],
      ['神奈川県川崎市', false, areaSeriesColor(1)],
      ['神奈川県川崎市（推計）', true, areaSeriesColor(1)],
    ])
  })

  it('区域の値の無いエリア（地図の範囲）は推移を出さない', () => {
    const bbox = { west: 139.55, south: 35.4, east: 139.72, north: 35.53 }
    const response = buildAreaSummaryResponse(
      [parts({ type: 'bbox', ref: 'bbox:139.55,35.4,139.72,35.53', bbox }, { stationCount: 79 })],
      STATS,
      RADIUS,
      null,
    )
    expect(areaSummaryPanels(response).map((panel) => panel.type)).toEqual(['areaSummary'])
    expect(areaSummaryTitleOf(response)).toBe('地図の範囲の要約')
  })

  it('内訳が多いときは、増減の大きい 10 と小さい 10（増減の無い行は外す）', () => {
    const row = (index: number, change: number | null) => ({
      ref: `muni:${index}`,
      grp: null,
      nameJa: `市${index}`,
      value: 1000,
      valueJa: '1,000 人',
      change,
      changeJa: change === null ? '—' : rateJa(change),
      future: null,
      futureJa: '—',
      stationCount: 0,
    })
    const exactly = Array.from({ length: MAX_BREAKDOWN_BARS }, (_, index) => row(index, 30 - index))
    expect(breakdownBarRows(exactly)).toEqual({ rows: exactly, trimmed: false })
    const many = [
      ...Array.from({ length: 61 }, (_, index) => row(index, 30 - index)),
      row(99, null),
    ]
    const trimmed = breakdownBarRows(many)
    expect(trimmed.trimmed).toBe(true)
    expect(trimmed.rows).toHaveLength(BREAKDOWN_EDGE_BARS * 2)
    expect(trimmed.rows[0]?.nameJa).toBe('市0')
    expect(trimmed.rows.at(-1)?.nameJa).toBe('市60')
    expect(trimmed.rows.some((each) => each.change === null)).toBe(false)
  })
})

describe('エリアの一覧（自己記述のカタログ）', () => {
  it('行政区域の行 → 共通 API の形（沿線の幅・書き方・区域の指標つき）', () => {
    const response = areasResponseSchema.parse(
      areasResponseOf(
        YOKOHAMA_ROWS.slice(0, 2).map(
          ({ values: _values, lineCd: _lineCd, widthM: _widthM, areaKm2: _areaKm2, ...rest }) =>
            rest,
        ),
      ),
    )
    expect(response.areas[0]).toMatchObject({
      ref: 'muni:14100',
      kind: 'city',
      nameJa: '横浜市',
      parentRef: 'pref:14',
      stationCount: 137,
    })
    expect(response.lineWidthsM).toEqual([500, 1000, 2000])
    expect(response.metrics).toHaveLength(24)
    expect(response.kinds.map((kind) => kind.kind)).toContain('line')
  })
})
