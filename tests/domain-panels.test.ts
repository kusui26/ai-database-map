import { describe, expect, it } from 'vitest'
import { type StationRow } from '@/shared/api'
import { buildStationDetail } from '@/domain/stations/presenter'
import {
  busPanels,
  employeePanels,
  establishmentPanels,
  formatPaxLatest,
  landPricePanels,
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
  operators: '東日本旅客鉄道・東京地下鉄・東海旅客鉄道',
  paxLatest: 1262604,
  lpNearUse: '商業地',
  levelComplete: false,
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

  it('駅カード：具体的な社名・最新乗降客・時系列欠損バッジ', () => {
    const card = stationCardPanel(detail)
    expect(card.stationName).toBe('東京')
    expect(card.prefecture).toBe('東京都')
    expect(card.operators).toBe('東日本旅客鉄道・東京地下鉄・東海旅客鉄道') // P5d の社名
    expect(card.paxLatest).toBe(1262604)
    expect(card.badges).toEqual([{ label: '乗降 時系列に欠損あり', level: 'warn' }])
  })

  it('社名欠損時は延べ社数にフォールバック、n_op も null なら null', () => {
    const withCount = stationCardPanel(buildStationDetail({ ...station, operators: null }, values))
    expect(withCount.operators).toBe('延べ3社')
    const noneCard = stationCardPanel(
      buildStationDetail({ ...station, nOp: null, operators: null, levelComplete: true }, values),
    )
    expect(noneCard.operators).toBeNull()
    expect(noneCard.badges).toEqual([])
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

const p5cValues = new Map<string, number>([
  // 地価（lp_med は年次系列＝P5d。現在値バーは最新年 2026 を使う）
  ['lp_near_price', 37600000],
  ['lp_near_dist_m', 252],
  ['lp_med_2026_500m', 24400000],
  ['lp_med_2011_1km', 14750000],
  ['lp_med_2021_1km', 16700000],
  ['lp_med_2026_1km', 19050000],
  ['lp_med_2026_2km', 5540000],
  ['lp_gr_2026_2025_1km', 7.6],
  ['lp_gr_2026_2023_1km', 15.1],
  // バス
  ['bus_n_1km', 44],
  ['bus_n2010_1km', 41],
  ['bus_n_local_1km', 33],
  ['bus_n_hw_1km', 17],
  ['bus_gr_1km', 7.3],
  // 事業所・従業者
  ['estab_n_2012_1km', 13909],
  ['estab_n_2021_1km', 15375],
  ['emp_n_2012_1km', 451361],
  ['emp_n_2021_1km', 565228],
  ['estab_gr_2021_2012_1km', 10.5],
  ['emp_gr_2021_2012_1km', 25.2],
])
const p5cDetail = buildStationDetail(station, p5cValues)

describe('landPricePanels', () => {
  it('最寄カード（価格・用途・距離）＋半径別バー＋増減率表', () => {
    const panels = landPricePanels(p5cDetail, 1000)
    expect(panels.map((p) => p.type)).toEqual(['statTable', 'trendChart', 'barChart', 'statTable'])
  })

  it('中央値の推移：選択半径の年次折れ線（P5e）', () => {
    const line = landPricePanels(p5cDetail, 1000).find((p) => p.type === 'trendChart')
    const trend = line?.type === 'trendChart' ? line : undefined
    expect(trend?.unit).toBe('円/㎡')
    expect(trend?.series[0]?.points.map((pt) => pt.x)).toEqual([2011, 2021, 2026])
    expect(trend?.series[0]?.points.at(-1)?.y).toBe(19050000)
  })

  it('最寄の地価公示：円/㎡・用途・m', () => {
    const [near] = landPricePanels(p5cDetail, 1000)
    const rows = near?.type === 'statTable' ? near.rows : []
    expect(rows).toEqual([
      { label: '公示価格', value: '37,600,000 円/㎡', flagged: false },
      { label: '用途', value: '商業地', flagged: false },
      { label: '最寄地点まで', value: '252 m', flagged: false },
    ])
  })

  it('中央値バー：選択半径を emphasis', () => {
    const bar = landPricePanels(p5cDetail, 1000).find((p) => p.type === 'barChart')
    const bars = bar?.type === 'barChart' ? bar.bars : []
    expect(bars.map((b) => b.label)).toEqual(['500m', '1km', '2km'])
    expect(bars.find((b) => b.label === '1km')?.emphasis).toBe(true)
    expect(bars.find((b) => b.label === '500m')?.emphasis).toBe(false)
  })

  it('lp_med は年次系列：現在値バーは最新年（2026）を使う', () => {
    const bar = landPricePanels(p5cDetail, 1000).find((p) => p.type === 'barChart')
    const oneKm = bar?.type === 'barChart' ? bar.bars.find((b) => b.label === '1km') : undefined
    expect(oneKm?.value).toBe(19050000) // 2026（2011=14,750,000 ではない）
  })

  it('500m 圏は増減率が非対応 → 空＋注記（カタログ駆動フォールド）', () => {
    const table = landPricePanels(p5cDetail, 500).at(-1)
    expect(table?.type).toBe('statTable')
    if (table?.type === 'statTable') {
      expect(table.rows).toEqual([])
      expect(table.note).toContain('500m')
    }
  })
})

describe('busPanels', () => {
  it('2010→現在の2点折れ線（P5e）＋内訳・増減表', () => {
    const panels = busPanels(p5cDetail, 1000)
    expect(panels.map((p) => p.type)).toEqual(['trendChart', 'statTable'])
    const line = panels[0]
    if (line?.type === 'trendChart') {
      expect(line.series[0]?.points).toEqual([
        { x: 2010, y: 41 },
        { x: 2023, y: 44 },
      ])
    }
    const table = panels[1]
    if (table?.type === 'statTable') {
      expect(table.rows).toEqual([
        { label: '一般バス停', value: '33 箇所', flagged: false },
        { label: '高速バス停', value: '17 箇所', flagged: false },
        { label: '対2010年 増減率', value: '+7.3%', flagged: false },
      ])
    }
  })
})

describe('establishmentPanels / employeePanels（P5e で分離）', () => {
  it('事業所タブ：事業所数の折れ線＋事業所増減率（従業者は含まない）', () => {
    const panels = establishmentPanels(p5cDetail, 1000)
    expect(panels.map((p) => p.type)).toEqual(['trendChart', 'statTable'])
    const chart = panels[0]
    if (chart?.type === 'trendChart') expect(chart.unit).toBe('事業所')
    const table = panels[1]
    if (table?.type === 'statTable') {
      expect(table.title).toBe('事業所数 増減率')
      expect(table.rows).toEqual([{ label: '2012→2021', value: '+10.5%', flagged: false }])
    }
  })

  it('従業者タブ：従業者数（人）の折れ線＋従業者増減率', () => {
    const panels = employeePanels(p5cDetail, 1000)
    expect(panels.map((p) => p.type)).toEqual(['trendChart', 'statTable'])
    const chart = panels[0]
    if (chart?.type === 'trendChart') {
      expect(chart.unit).toBe('人')
      expect(chart.series[0]?.points.at(-1)?.y).toBe(565228)
    }
    const table = panels[1]
    if (table?.type === 'statTable') {
      expect(table.title).toBe('従業者数 増減率')
      expect(table.rows).toEqual([{ label: '2012→2021', value: '+25.2%', flagged: false }])
    }
  })
})

describe('P5c/P5e パネルは Protocol スキーマに合致', () => {
  it('地価・バス・事業所・従業者すべて parse できる', () => {
    const all = [
      ...landPricePanels(p5cDetail, 1000),
      ...busPanels(p5cDetail, 1000),
      ...establishmentPanels(p5cDetail, 1000),
      ...employeePanels(p5cDetail, 1000),
    ]
    for (const panel of all) expect(() => panelSchema.parse(panel)).not.toThrow()
  })
})
