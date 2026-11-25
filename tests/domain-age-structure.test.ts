/**
 * 年齢別の人口のパネル（2026-11-25・人口の年齢 PR-3・計画書 261122 §6.4）。
 * 図の人数は年齢の表、チップの数字は値の表の指標から取る——同じ駅で同じ値になることと、注意が駅に固有のときだけ出ることを見る。
 */

import { describe, expect, it } from 'vitest'
import { stationDetailSchema } from '@/shared/api'
import { panelSchema, type TrendChartPanel } from '@/shared/protocol'
import { CATEGORY_COLORS } from '@/shared/constants'
import { ageStructureOf, buildStationDetail } from '@/domain/stations/presenter'
import {
  AGE_BAND_COLORS,
  AGE_BAND_LABELS_JA,
  ageStructurePanel,
} from '@/domain/stations/age-structure'
import { populationPanels } from '@/domain/stations/panels'
import {
  AGE_YEARS,
  KOSUGI_1KM,
  KOSUGI_STATION,
  KOSUGI_VALUES_1KM,
  YABACHO_1KM,
  YABACHO_VALUES_1KM,
  ageRowsOf,
  totalsOf,
} from './fixtures/age-structure'

const kosugi = buildStationDetail(
  KOSUGI_STATION,
  new Map(Object.entries(KOSUGI_VALUES_1KM)),
  ageRowsOf(1000, KOSUGI_1KM),
)

function panelOf(detail = kosugi, radiusM = 1000): TrendChartPanel {
  const panel = ageStructurePanel(detail, radiusM)
  if (panel === null) throw new Error('年齢の図がありません')
  return panel
}

describe('年齢別の人口の図（武蔵小杉 1km 圏）', () => {
  it('積み上げ縦棒・題に半径・単位は人・2025 年から推計', () => {
    const panel = panelOf()
    expect(panel.type).toBe('trendChart')
    expect(panel.stacked).toBe(true)
    expect(panel.title).toBe('年齢別の人口（1km圏）')
    expect(panel.unit).toBe('人')
    expect(panel.format).toBe('int')
    expect(panel.projectedFrom).toBe(2025)
    expect(() => panelSchema.parse(panel)).not.toThrow()
  })

  it('積む順は下から 0〜14 → 15〜64 → 65〜74 → 75 歳以上（凡例も同じ順）・15〜64 歳は人口の色', () => {
    const panel = panelOf()
    expect(panel.series.map((series) => series.label)).toEqual([
      '0〜14歳',
      '15〜64歳',
      '65〜74歳',
      '75歳以上',
    ])
    expect(panel.series.map((series) => series.color)).toEqual(Object.values(AGE_BAND_COLORS))
    expect(panel.series[1]?.color).toBe(CATEGORY_COLORS.population)
    expect(Object.values(AGE_BAND_LABELS_JA)).toEqual(panel.series.map((series) => series.label))
  })

  it('8 年（2015〜2050・5 年刻み）の人数が年齢の表のまま入る', () => {
    const working = panelOf().series[1]
    expect(working?.points.map((point) => point.x)).toEqual([...AGE_YEARS])
    expect(working?.points.map((point) => point.y)).toEqual(
      AGE_YEARS.map((year) => KOSUGI_1KM[year]?.counts[1]),
    )
  })

  it('合計は 4 区分の和＝既存の総数の列（2015・2020 は国勢調査、2050 は R6 推計）', () => {
    const totals = panelOf().totals?.map((total) => total.y)
    expect(totals).toEqual(totalsOf(KOSUGI_1KM))
    expect(totals?.[0]).toBe(KOSUGI_VALUES_1KM.pop_2015_1km)
    expect(totals?.[1]).toBe(KOSUGI_VALUES_1KM.pop_2020_1km)
    expect(totals?.at(-1)).toBe(KOSUGI_VALUES_1KM.pop_pred_2024_2050_1km)
  })

  it('チップ 3 つは値の表の指標から（順位・色分け・概要と同じ数と書式）', () => {
    expect(panelOf().stats).toEqual([
      { label: '15〜64歳（2020年）', value: '55,863 人・74.1%', flagged: false },
      { label: '高齢化率 2020→2050', value: '12.7%→25.2%', flagged: false },
      { label: '15〜64歳 2020→2050', value: '-7.2%', flagged: false },
    ])
  })

  it('図の 2020 年の 15〜64 歳と、チップの人数が同じ（2 つの表が同じ build の値）', () => {
    const at2020 = panelOf().series[1]?.points.find((point) => point.x === 2020)?.y
    expect(at2020).toBe(KOSUGI_VALUES_1KM.pop15_64_2020_1km)
  })

  it('年齢不詳が少なく母数も大きい駅は、注意を出さない', () => {
    expect(panelOf().flags).toEqual([])
  })
})

describe('注意（その駅に固有のときだけ）', () => {
  it('年齢不詳が多い（pop_ageunk_2020）：割合つきの 1 文と、チップの ⚠', () => {
    const yabacho = buildStationDetail(
      { ...KOSUGI_STATION, grp: '矢場町#0', stationName: '矢場町', label: '矢場町' },
      new Map(Object.entries(YABACHO_VALUES_1KM)),
      ageRowsOf(1000, YABACHO_1KM),
    )
    const panel = panelOf(yabacho)
    expect(panel.flags).toEqual([
      { label: '年齢不詳が多い地域です（2020年 30.4%）', level: 'warn' },
    ])
    expect(panel.stats?.map((stat) => stat.flagged)).toEqual([true, true, true])
  })

  it('年齢不詳のフラグが立たなければ、不詳の人数が多くても出さない（判定はカタログのフラグ）', () => {
    const quiet = buildStationDetail(
      KOSUGI_STATION,
      new Map(Object.entries({ ...YABACHO_VALUES_1KM, pop_ageunk_2020_1km: 0 })),
      ageRowsOf(1000, YABACHO_1KM),
    )
    expect(panelOf(quiet).flags).toEqual([])
  })

  it('2020 年の総数が小さい（pop_lowbase_2020）：割合・増減率は参考値の 1 文と、チップの ⚠', () => {
    const small = buildStationDetail(
      KOSUGI_STATION,
      new Map(Object.entries({ ...KOSUGI_VALUES_1KM, pop_lowbase_2020_1km: 1 })),
      ageRowsOf(1000, KOSUGI_1KM),
    )
    const panel = panelOf(small)
    expect(panel.flags).toEqual([{ label: '母数が小さく割合・増減率は参考値', level: 'warn' }])
    expect(panel.stats?.every((stat) => stat.flagged)).toBe(true)
  })

  it('65 歳以上が少ない（pop65_lowbase_2020）は出さない——この図は 65 歳以上の増減率を出さない', () => {
    const few = buildStationDetail(
      KOSUGI_STATION,
      new Map(Object.entries({ ...KOSUGI_VALUES_1KM, pop65_lowbase_2020_1km: 1 })),
      ageRowsOf(1000, KOSUGI_1KM),
    )
    expect(panelOf(few).flags).toEqual([])
  })
})

describe('無い値・無い駅', () => {
  it('年齢の表に無い駅は図を出さない（人口タブは推移の図と増減率の表だけ）', () => {
    const none = buildStationDetail(KOSUGI_STATION, new Map(Object.entries(KOSUGI_VALUES_1KM)))
    expect(none.ageStructure).toBeNull()
    expect(ageStructurePanel(none, 1000)).toBeNull()
    expect(populationPanels(none, 1000).map((panel) => panel.type)).toEqual([
      'trendChart',
      'statTable',
    ])
  })

  it('選んだ半径の行が無ければ図を出さない（別の半径の行を流用しない）', () => {
    expect(ageStructurePanel(kosugi, 500)).toBeNull()
  })

  it('チップの材料が無い指標は、そのチップだけ出さない', () => {
    const values = Object.fromEntries(
      Object.entries(KOSUGI_VALUES_1KM).filter(([key]) => key !== 'pop65_share_pred_2024_2050_1km'),
    )
    const partial = buildStationDetail(
      KOSUGI_STATION,
      new Map(Object.entries(values)),
      ageRowsOf(1000, KOSUGI_1KM),
    )
    expect(panelOf(partial).stats?.map((stat) => stat.label)).toEqual([
      '15〜64歳（2020年）',
      '15〜64歳 2020→2050',
    ])
  })

  it('配備の切り替わりの間の古い応答（ageStructure が無い）は null と読む', () => {
    const old = stationDetailSchema.parse({ station: KOSUGI_STATION, series: [] })
    expect(old.ageStructure).toBeNull()
  })
})

describe('半径ごとにまとめる（ageStructureOf）', () => {
  it('行の順に関わらず、半径の昇順・年の昇順にまとめる', () => {
    const rows = [...ageRowsOf(1000, KOSUGI_1KM), ...ageRowsOf(500, YABACHO_1KM)].reverse()
    const structure = ageStructureOf(rows)
    expect(structure?.radii.map((radius) => radius.radiusM)).toEqual([500, 1000])
    expect(structure?.radii[1]?.years.map((year) => year.year)).toEqual([...AGE_YEARS])
    expect(stationDetailSchema.shape.ageStructure.parse(structure)).toEqual(structure)
  })

  it('行が無ければ null', () => {
    expect(ageStructureOf([])).toBeNull()
  })

  it('半径を替えると、その半径の行で描き直す（再取得しない）', () => {
    const both = buildStationDetail(KOSUGI_STATION, new Map(Object.entries(KOSUGI_VALUES_1KM)), [
      ...ageRowsOf(1000, KOSUGI_1KM),
      ...ageRowsOf(500, YABACHO_1KM),
    ])
    expect(panelOf(both, 500).totals?.map((total) => total.y)).toEqual(totalsOf(YABACHO_1KM))
    expect(panelOf(both, 500).title).toBe('年齢別の人口（500m圏）')
  })
})
