import { describe, expect, it } from 'vitest'
import { type StationRow } from '@/shared/api'
import { buildStationDetail } from '@/domain/stations/presenter'
import {
  formatPaxLatest,
  passengerPanels,
  paxTrendPanel,
  populationPanels,
  stationCardPanel,
} from '@/domain/stations/panels'
import { panelSchema } from '@/shared/protocol'
import { CATEGORY_COLORS } from '@/shared/constants'

const station: StationRow = {
  grp: '東京#0',
  stationName: '東京',
  label: '東京',
  searchLabel: '東京（東京都）',
  prefecture: '東京都',
  lon: 139.767,
  lat: 35.681,
  nOp: 3,
  paxLatest: 1262604,
  lpNearUse: '商業地',
  levelComplete: false,
  flagYoy: false,
  flagCovid: false,
}

const values = new Map<string, number>([
  ['pax_2011', 920144],
  ['pax_2020', 1000000],
  ['pax_2024', 1262604],
  ['rate_yoy', 7.3],
  ['rate_covid', -5.7],
  ['flag_yoy', 0],
  ['flag_covid', 1], // コロナ前後比の信頼性フラグが立つ
])

const detail = buildStationDetail(station, values)

describe('passengerPanels', () => {
  it('カード → 推移チャートの順で Panel[] を返す（UI/AI 同一配列）', () => {
    expect(passengerPanels(detail).map((panel) => panel.type)).toEqual([
      'stationCard',
      'trendChart',
    ])
  })

  it('駅カード：延べ事業者数・最新乗降客・時系列欠損バッジ', () => {
    const card = stationCardPanel(detail)
    expect(card.stationName).toBe('東京')
    expect(card.prefecture).toBe('東京都')
    expect(card.operators).toBe('延べ3社')
    expect(card.paxLatest).toBe(1262604)
    expect(card.badges).toEqual([{ label: '乗降 時系列に欠損あり', level: 'warn' }])
  })

  it('事業者数が null ならバッジ・operators も欠損に', () => {
    const card = stationCardPanel(
      buildStationDetail({ ...station, nOp: null, levelComplete: true }, values),
    )
    expect(card.operators).toBeNull()
    expect(card.badges).toEqual([])
  })

  it('推移チャート：年昇順の点・カテゴリ色・前年比/コロナ比 KPI（フラグ解決）', () => {
    const chart = paxTrendPanel(detail)
    expect(chart.title).toBe('乗降客数の推移')
    expect(chart.unit).toBe('人/日')
    expect(chart.format).toBe('int')
    expect(chart.series[0]?.color).toBe(CATEGORY_COLORS.passenger)
    expect(chart.series[0]?.points.map((point) => point.x)).toEqual([2011, 2020, 2024])
    expect(chart.series[0]?.points.at(-1)?.y).toBe(1262604)
    expect(chart.stats).toEqual([
      { label: '前年比', value: '+7.3%', flagged: false }, // flag_yoy = 0
      { label: 'コロナ前後比', value: '-5.7%', flagged: true }, // flag_covid = 1
    ])
  })

  it('生成した Panel はすべて Protocol スキーマに合致する', () => {
    for (const panel of passengerPanels(detail, 'compact')) {
      expect(() => panelSchema.parse(panel)).not.toThrow()
      expect(panel.size).toBe('compact')
    }
  })

  it('formatPaxLatest：int・人/日、欠損は em dash', () => {
    expect(formatPaxLatest(1262604)).toBe('1,262,604 人/日')
    expect(formatPaxLatest(null)).toBe('—')
  })
})

const popValues = new Map<string, number>([
  // 実績（pop）: 1km と 500m
  ['pop_2015_1km', 5000],
  ['pop_2020_1km', 6000],
  ['pop_2015_500m', 100],
  ['pop_2020_500m', 120],
  // R6推計（v2024）@1km
  ['pop_pred_2024_2020_1km', 5900],
  ['pop_pred_2024_2025_1km', 6100],
  // H30推計（v2018）@1km
  ['pop_pred_2018_2020_1km', 6500],
  ['pop_pred_2018_2025_1km', 6700],
  // 増減率：1km は非フラグ、500m は lowbase フラグ
  ['pop_gr_2020_2015_1km', 20],
  ['pop_lowbase_2015_1km', 0],
  ['pop_gr_2020_2015_500m', 20],
  ['pop_lowbase_2015_500m', 1],
  // H30 推計誤差（2020）@1km
  ['pop_err_2020_pred_2018_1km', 47.1],
  ['pop_lowbase_2020_1km', 0],
  // 秘匿メッシュ割合 @500m
  ['pop_2020_500m_hidden_ratio', 0.218],
])
const popDetail = buildStationDetail(station, popValues)

describe('populationPanels', () => {
  it('重ねチャート → 増減率ミニ表の順で返す', () => {
    expect(populationPanels(popDetail, 1000).map((panel) => panel.type)).toEqual([
      'trendChart',
      'statTable',
    ])
  })

  it('重ねチャート：実績（実線）＋R6/H30 推計（破線）の3系列', () => {
    const [chart] = populationPanels(popDetail, 1000)
    const trend = chart?.type === 'trendChart' ? chart : undefined
    expect(trend?.series.map((s) => s.label)).toEqual(['実績', 'R6推計', 'H30推計'])
    expect(trend?.series[0]?.dashed).toBeFalsy()
    expect(trend?.series[1]?.dashed).toBe(true)
    expect(trend?.series[2]?.dashed).toBe(true)
    expect(trend?.series[0]?.points).toEqual([
      { x: 2015, y: 5000 },
      { x: 2020, y: 6000 },
    ])
  })

  it('半径で系列が入れ替わる（再フェッチ不要の client 絞り）', () => {
    const [chart] = populationPanels(popDetail, 500)
    const trend = chart?.type === 'trendChart' ? chart : undefined
    expect(trend?.series[0]?.points).toEqual([
      { x: 2015, y: 100 },
      { x: 2020, y: 120 },
    ])
  })

  it('1km：H30 推計誤差を注記、lowbase なし・秘匿なし', () => {
    const [chart] = populationPanels(popDetail, 1000)
    const labels = chart?.type === 'trendChart' ? chart.flags.map((f) => f.label) : []
    expect(labels.some((l) => l.includes('H30推計は2020年実績を +47.1% 乖離'))).toBe(true)
    expect(labels.some((l) => l.includes('母数が小さく'))).toBe(false)
    expect(labels.some((l) => l.includes('秘匿'))).toBe(false)
  })

  it('500m：lowbase ⚠ と秘匿メッシュ割合の注記が出る', () => {
    const [chart, table] = populationPanels(popDetail, 500)
    const flags = chart?.type === 'trendChart' ? chart.flags : []
    expect(flags.some((f) => f.label.includes('母数が小さく') && f.level === 'warn')).toBe(true)
    expect(flags.some((f) => f.label.includes('秘匿・合算メッシュ割合 21.8%（2020年）'))).toBe(true)
    // 増減率ミニ表の行が lowbase でフラグ
    const rows = table?.type === 'statTable' ? table.rows : []
    expect(rows.find((r) => r.label === '2015→2020')?.flagged).toBe(true)
  })

  it('増減率ミニ表：yearBase→year ラベル・符号付き %', () => {
    const [, table] = populationPanels(popDetail, 1000)
    const rows = table?.type === 'statTable' ? table.rows : []
    expect(rows.find((r) => r.label === '2015→2020')).toEqual({
      label: '2015→2020',
      value: '+20.0%',
      flagged: false,
    })
  })

  it('生成した人口 Panel はすべて Protocol スキーマに合致', () => {
    for (const panel of populationPanels(popDetail, 500)) {
      expect(() => panelSchema.parse(panel)).not.toThrow()
    }
  })
})
