import { describe, expect, it } from 'vitest'
import { type StationRow } from '@/shared/api'
import { buildStationDetail } from '@/domain/stations/presenter'
import {
  formatPaxLatest,
  passengerPanels,
  paxTrendPanel,
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
