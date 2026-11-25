/**
 * 積み上げの推移チャートの読み方の規則（`src/shared/trend-stack.ts`・2026-11-25）。
 * Web（Chart.js）・ビューア（SVG）・ECharts・AI の文が同じ年に合計を書き、同じ年から推計と読むための 1 か所。
 */

import { describe, expect, it } from 'vitest'
import { type TrendChartPanel } from '@/shared/protocol'
import {
  isProjected,
  labeledTotalXs,
  projectedIndex,
  stackTotalAt,
  summaryXs,
  trendXs,
} from '@/shared/trend-stack'

const YEARS = [2015, 2020, 2025, 2030, 2035, 2040, 2045, 2050]

function panelOf(overrides: Partial<TrendChartPanel> = {}): TrendChartPanel {
  return {
    type: 'trendChart',
    title: '年齢別の人口（1km圏）',
    unit: '人',
    format: 'int',
    stacked: true,
    projectedFrom: 2025,
    flags: [],
    series: [
      { label: '0〜14歳', points: YEARS.map((x) => ({ x, y: 10 })) },
      { label: '15〜64歳', points: [...YEARS].reverse().map((x) => ({ x, y: 50 })) },
    ],
    ...overrides,
  }
}

describe('年と推計', () => {
  it('年は全系列の和集合の昇順（系列の並びに依らない）', () => {
    expect(trendXs(panelOf())).toEqual(YEARS)
  })

  it('projectedFrom 以降が推計。無ければどの年も実績', () => {
    expect(isProjected(panelOf(), 2020)).toBe(false)
    expect(isProjected(panelOf(), 2025)).toBe(true)
    expect(isProjected(panelOf({ projectedFrom: undefined }), 2050)).toBe(false)
    expect(projectedIndex(panelOf(), YEARS)).toBe(2)
    expect(projectedIndex(panelOf({ projectedFrom: undefined }), YEARS)).toBe(-1)
  })
})

describe('合計を書く年', () => {
  it('推計のある図は最後の実績の年と最後の年だけ', () => {
    expect([...labeledTotalXs(panelOf(), YEARS)]).toEqual([2020, 2050])
  })

  it('推計の無い図（売上の 2 時点）は全部の年', () => {
    expect([...labeledTotalXs(panelOf({ projectedFrom: undefined }), [2016, 2021])]).toEqual([
      2016, 2021,
    ])
  })

  it('全部が推計（最初の年から推計）なら全部の年（境が無い）', () => {
    expect([...labeledTotalXs(panelOf({ projectedFrom: 2000 }), YEARS)]).toEqual(YEARS)
  })
})

describe('合計の値', () => {
  it('宣言された合計（totals）を優先する（内訳の丸め和ではない）', () => {
    const panel = panelOf({ totals: [{ x: 2020, y: 61 }] })
    expect(stackTotalAt(panel, 2020)).toBe(61)
  })

  it('宣言が無い年・null の年は系列の和', () => {
    const panel = panelOf({ totals: [{ x: 2020, y: null }] })
    expect(stackTotalAt(panel, 2020)).toBe(60)
    expect(stackTotalAt(panel, 2050)).toBe(60)
  })
})

describe('AI の文で言う年', () => {
  it('推計のある図は最後の実績の年 → 最後の年', () => {
    expect(summaryXs(panelOf(), YEARS)).toEqual([2020, 2050])
  })

  it('推計の無い図は最初の年 → 最後の年、1 年だけなら起点だけ', () => {
    expect(summaryXs(panelOf({ projectedFrom: undefined }), [2016, 2021])).toEqual([2016, 2021])
    expect(summaryXs(panelOf({ projectedFrom: undefined }), [2021])).toEqual([2021])
    expect(summaryXs(panelOf(), [])).toEqual([])
  })
})
