/**
 * 積み上げ縦棒の合計とツールチップの文（`src/components/panels/stackedChart.ts`・2026-11-25）。
 * canvas に描く文は実ブラウザでも読めないので、ここで固定する（実ブラウザは図の色と位置を `ui.age-structure` が見る）。
 */

import { describe, expect, it } from 'vitest'
import { type TrendChartPanel } from '@/shared/protocol'
import {
  shownTotal,
  stackTooltipLabel,
  stackTooltipTitle,
  stackTooltipTotal,
  type StackChart,
  type StackTooltipItem,
} from '@/components/panels/stackedChart'
import { buildStationDetail } from '@/domain/stations/presenter'
import { ageStructurePanel } from '@/domain/stations/age-structure'
import { stackedTrendFixture } from './fixtures/panels'
import {
  AGE_YEARS,
  KOSUGI_1KM,
  KOSUGI_STATION,
  KOSUGI_VALUES_1KM,
  ageRowsOf,
} from './fixtures/age-structure'

const age = ageStructurePanel(
  buildStationDetail(
    KOSUGI_STATION,
    new Map(Object.entries(KOSUGI_VALUES_1KM)),
    ageRowsOf(1000, KOSUGI_1KM),
  ),
  1000,
)
if (age === null) throw new Error('年齢の図がありません')
const XS: readonly number[] = [...AGE_YEARS]

/** Chart.js の代わり（系列の値と、凡例で隠したか）。 */
function chartOf(panel: TrendChartPanel, hidden: readonly number[] = []): StackChart {
  return {
    data: {
      datasets: panel.series.map((series) => ({
        data: XS.map((x) => series.points.find((point) => point.x === x)?.y ?? null),
      })),
    },
    isDatasetVisible: (index) => !hidden.includes(index),
  }
}

function itemOf(chart: StackChart, panel: TrendChartPanel, band: number, year: number) {
  const dataIndex = XS.indexOf(year)
  const item: StackTooltipItem = {
    chart,
    dataIndex,
    parsed: { y: panel.series[band]?.points.find((point) => point.x === year)?.y ?? null },
    dataset: { label: panel.series[band]?.label },
  }
  return item
}

describe('ツールチップ（年齢別の人口）', () => {
  const chart = chartOf(age)

  it('題は「年」、推計の年は「（推計）」をつける', () => {
    expect(stackTooltipTitle([itemOf(chart, age, 1, 2020)], age, XS)).toBe('2020年')
    expect(stackTooltipTitle([itemOf(chart, age, 1, 2030)], age, XS)).toBe('2030年（推計）')
    expect(stackTooltipTitle([], age, XS)).toBe('')
  })

  it('1 行は人数と、その年の合計に占める割合', () => {
    expect(stackTooltipLabel(itemOf(chart, age, 1, 2020), age, XS)).toBe(
      '15〜64歳: 55,863 人（74.1%）',
    )
    expect(stackTooltipLabel(itemOf(chart, age, 3, 2050), age, XS)).toBe(
      '75歳以上: 11,239 人（13.8%）',
    )
  })

  it('合計行は宣言された合計（既存の総数の列と同じ）', () => {
    expect(stackTooltipTotal([itemOf(chart, age, 0, 2050)], age, XS)).toBe('合計: 81,565 人')
  })

  it('凡例で区分を隠すと、合計と割合は見えている区分だけで数える（見えている棒と合う）', () => {
    const hidden = chartOf(age, [0]) // 0〜14 歳を隠す
    expect(shownTotal(hidden, age, XS.indexOf(2020), 2020)).toBe(75_418 - 9_965)
    // 55,863 ÷（75,418 − 9,965）＝ 85.3%
    expect(stackTooltipLabel(itemOf(hidden, age, 1, 2020), age, XS)).toBe(
      '15〜64歳: 55,863 人（85.3%）',
    )
  })
})

describe('ツールチップ（売上＝推計の無い積み上げ）', () => {
  const sales = stackedTrendFixture()
  const xs = [2016, 2021]
  const chart: StackChart = {
    data: {
      datasets:
        sales.type === 'trendChart'
          ? sales.series.map((series) => ({ data: series.points.map((point) => point.y) }))
          : [],
    },
    isDatasetVisible: () => true,
  }

  it('題に（推計）はつかない。合計は内訳の丸め和ではなく宣言された値', () => {
    if (sales.type !== 'trendChart') throw new Error('見本が違う')
    const item: StackTooltipItem = {
      chart,
      dataIndex: 0,
      parsed: { y: 1_469.2 },
      dataset: { label: '小売' },
    }
    expect(stackTooltipTitle([item], sales, xs)).toBe('2016年')
    expect(stackTooltipTotal([item], sales, xs)).toBe('合計: 1,902 百万円')
    expect(stackTooltipLabel(item, sales, xs)).toBe('小売: 1,469 百万円（77.2%）')
  })
})
