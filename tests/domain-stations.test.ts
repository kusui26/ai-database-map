import { describe, expect, it } from 'vitest'
import { type StationRow } from '@/shared/api'
import { buildStationDetail } from '@/domain/stations/presenter'

const station: StationRow = {
  grp: '東京#0',
  stationName: '東京',
  label: '東京',
  searchLabel: '東京（東京都）',
  prefecture: '東京都',
  municipality: '千代田区',
  lon: 139.767,
  lat: 35.681,
  nOp: 5,
  operators: '東日本旅客鉄道・東京地下鉄',
  paxLatest: 1262604,
  lpNearUse: '商業地',
  levelComplete: true,
}

const values = new Map<string, number>([
  ['pop_2015_1km', 5000],
  ['pop_2020_1km', 6000],
  ['pop_2015_2km', 10000],
  ['pop_2020_2km', 11000],
  ['pop_gr_2020_2015_1km', 20],
  ['pop_lowbase_2015_1km', 1], // 1km の増減率フラグが立つ
  ['pop_gr_2020_2015_2km', 10],
  ['pop_lowbase_2015_2km', 0],
  ['pop_pred_2024_2030_1km', 5800],
  ['pop_pred_2018_2030_1km', 5900],
  ['pax_2020', 1000],
  ['pax_2024', 1200],
  ['lp_med_2026_1km', 94600],
  ['lp_lown_1km', 0],
])

const detail = buildStationDetail(station, values)
const find = (baseMetric: string, radiusM: number | null, vintage: number | null = null) =>
  detail.series.find(
    (s) => s.baseMetric === baseMetric && s.radiusM === radiusM && s.vintage === vintage,
  )

describe('buildStationDetail', () => {
  it('駅属性をそのまま保持', () => {
    expect(detail.station).toBe(station)
  })

  it('人口 level を半径ごとに別系列・年昇順・format 済み', () => {
    const s1 = find('pop', 1000)
    expect(s1?.category).toBe('population')
    expect(s1?.points.map((p) => p.year)).toEqual([2015, 2020])
    expect(s1?.points[0]?.formatted).toBe('5,000')
    expect(s1?.points[1]?.formatted).toBe('6,000')
    expect(find('pop', 2000)?.points[1]?.value).toBe(11000)
  })

  it('増減率は kind=growth・符号付き・フラグ解決', () => {
    const g1 = find('pop_gr', 1000)
    expect(g1?.kind).toBe('growth')
    expect(g1?.points[0]?.formatted).toBe('+20.0%')
    expect(g1?.points[0]?.flagged).toBe(true) // pop_lowbase_2015_1km = 1
    expect(find('pop_gr', 2000)?.points[0]?.flagged).toBe(false) // = 0
  })

  it('バッジは notice フラグで解く：被覆<100% の大駅は ⚠ が残る（260731）', () => {
    // rate_covid は 除外=flag_covid_lown（|率|>100%）／バッジ=flag_covid（複合）。
    // 新宿のように「一部の社しかデータが無い」駅は、除外はされないが ⚠ は出す。
    const shinjuku = buildStationDetail(
      station,
      new Map<string, number>([
        ['rate_covid', -16.9],
        ['flag_covid', 1], // 被覆 4/5
        ['flag_covid_lown', 0], // 低分母ではない
      ]),
    )
    const point = shinjuku.series.find((s) => s.baseMetric === 'pax_rate')?.points[0]
    expect(point?.formatted).toBe('-16.9%')
    expect(point?.flagged).toBe(true)
  })

  it('バッジ：注意フラグが立たなければ ⚠ は出ない', () => {
    const clean = buildStationDetail(
      station,
      new Map<string, number>([
        ['rate_covid', -5.7],
        ['flag_covid', 0],
        ['flag_covid_lown', 0],
      ]),
    )
    expect(clean.series.find((s) => s.baseMetric === 'pax_rate')?.points[0]?.flagged).toBe(false)
  })

  it('将来推計は vintage（R6=2024 / H30=2018）で別系列', () => {
    expect(find('pop_pred', 1000, 2024)?.points[0]?.value).toBe(5800)
    expect(find('pop_pred', 1000, 2018)?.points[0]?.value).toBe(5900)
  })

  it('半径なし指標（乗降客）も系列化', () => {
    const pax = find('pax', null)
    expect(pax?.points.map((p) => p.value)).toEqual([1000, 1200])
  })

  it('各点はカタログ key を持つ（addressable）', () => {
    const pax = find('pax', null)
    expect(pax?.points.map((p) => p.key)).toEqual(['pax_2020', 'pax_2024'])
  })

  it('フラグ列（kind=flag）は系列に含めない', () => {
    expect(detail.series.every((s) => s.kind !== 'flag')).toBe(true)
    expect(find('pop_lowbase', 1000)).toBeUndefined()
  })

  it('値のない指標は系列に現れない（NaN スキップ相当）', () => {
    expect(find('bus_n', 1000)).toBeUndefined()
    expect(find('estab_n', 5000)).toBeUndefined()
  })

  it('地価中央値は yen 整形・非フラグ', () => {
    const lp = find('lp_med', 1000)
    expect(lp?.points[0]?.formatted).toBe('94,600')
    expect(lp?.points[0]?.flagged).toBe(false)
  })
})
