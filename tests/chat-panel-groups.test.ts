/**
 * src/components/chat/panelGroups：チャット応答パネルの効果グループ化＋⤢昇格パラメータ導出（純関数）。
 * assemble の並び（駅詳細＝カード＋本文／ランキング／散布）を境界復元し、ツール入力と照合して
 * 昇格先パラメータ（都道府県・順序・x/y キー等）を忠実に復元できることを担保する。
 */

import { describe, expect, it } from 'vitest'
import { requireEntry } from '@/shared/catalog'
import { type Panel } from '@/shared/protocol'
import { buildPanelGroups, toolCallsOf, type ToolCall } from '@/components/chat/panelGroups'

const stationCard: Panel = {
  type: 'stationCard',
  grp: '東京#0',
  stationName: '東京',
  label: '東京',
  prefecture: '東京都',
  operators: '東日本旅客鉄道',
  paxLatest: 1262604,
  badges: [],
}
const trend: Panel = {
  type: 'trendChart',
  title: '人口の推移',
  unit: '人',
  format: 'int',
  flags: [],
  series: [{ label: '実績', points: [{ x: 2020, y: 95000 }] }],
}
const rankingTable: Panel = {
  type: 'rankingTable',
  title: 'ランキング',
  metricKey: 'pop_gr_2020_2015_1km',
  unit: '%',
  rows: [],
}
const scatter: Panel = {
  type: 'scatter',
  title: '散布',
  xLabel: requireEntry('pop_gr_2020_2015_2km').labelJa,
  yLabel: requireEntry('rate_covid').labelJa,
  xUnit: '%',
  yUnit: '%',
  points: [],
  clusterCount: 4,
}

const toolCalls: ToolCall[] = [
  { name: 'getStationDetail', input: { grp: '東京#0', category: 'population' } },
  {
    name: 'rankStations',
    input: {
      metric: 'pop_gr_2020_2015_1km',
      prefectures: ['千葉県'],
      order: 'desc',
      excludeLowN: true,
    },
  },
  {
    name: 'compareGrowth',
    input: { x: 'pop_gr_2020_2015_2km', y: 'rate_covid', prefectures: ['東京都'] },
  },
]

describe('buildPanelGroups', () => {
  it('駅詳細（カード＋本文）を1グループに束ね、詳細昇格（grp＋category）を導く', () => {
    const groups = buildPanelGroups([stationCard, trend], toolCalls)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.panels.map((panel) => panel.type)).toEqual(['stationCard', 'trendChart'])
    expect(groups[0]?.promotion).toEqual({ kind: 'detail', grp: '東京#0', category: 'population' })
  })

  it('ランキングは metricKey 一致で都道府県/順序/除外を復元', () => {
    const groups = buildPanelGroups([rankingTable], toolCalls)
    expect(groups[0]?.promotion).toEqual({
      kind: 'ranking',
      metricKey: 'pop_gr_2020_2015_1km',
      prefectures: ['千葉県'],
      order: 'desc',
      excludeLowN: true,
    })
  })

  it('散布は x/y ラベル一致で x/y キー・都道府県を復元（運営会社なしは空配列）', () => {
    const groups = buildPanelGroups([scatter], toolCalls)
    expect(groups[0]?.promotion).toEqual({
      kind: 'scatter',
      xKey: 'pop_gr_2020_2015_2km',
      yKey: 'rate_covid',
      prefectures: ['東京都'],
      operators: [],
      excludeLowN: false,
    })
  })

  it('散布の運営会社フィルタも昇格パラメータに復元される（260730）', () => {
    const withOperators: ToolCall[] = [
      {
        name: 'compareGrowth',
        input: {
          x: 'pop_gr_2020_2015_2km',
          y: 'rate_covid',
          prefectures: ['東京都'],
          operators: ['東日本旅客鉄道', '東京地下鉄'],
        },
      },
    ]
    const groups = buildPanelGroups([scatter], withOperators)
    expect(groups[0]?.promotion).toEqual({
      kind: 'scatter',
      xKey: 'pop_gr_2020_2015_2km',
      yKey: 'rate_covid',
      prefectures: ['東京都'],
      operators: ['東日本旅客鉄道', '東京地下鉄'],
      excludeLowN: false,
    })
  })

  it('複数効果が混在しても境界を正しく分ける（詳細→ランキング→散布）', () => {
    const groups = buildPanelGroups([stationCard, trend, rankingTable, scatter], toolCalls)
    expect(groups.map((group) => group.promotion?.kind)).toEqual(['detail', 'ranking', 'scatter'])
  })

  it('markdown 等の単独パネルは昇格なし', () => {
    const markdown: Panel = { type: 'markdown', body: 'こんにちは' }
    const groups = buildPanelGroups([markdown], [])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.promotion).toBeNull()
  })

  it('ツール呼び出しが無くてもランキングは metricKey と既定で昇格可能（散布はキー不明で不可）', () => {
    const ranking = buildPanelGroups([rankingTable], [])
    expect(ranking[0]?.promotion).toEqual({
      kind: 'ranking',
      metricKey: 'pop_gr_2020_2015_1km',
      prefectures: [],
      order: 'desc',
      excludeLowN: false,
    })
    const sc = buildPanelGroups([scatter], [])
    expect(sc[0]?.promotion).toBeNull()
  })
})

describe('toolCallsOf', () => {
  it('tool-<name> と dynamic-tool から名前＋入力を抽出する', () => {
    const parts = [
      { type: 'text', text: 'hi' },
      { type: 'tool-rankStations', input: { metric: 'rate_covid' } },
      { type: 'dynamic-tool', toolName: 'searchStations', input: { query: '東京' } },
      { type: 'data-map' },
    ]
    expect(toolCallsOf(parts)).toEqual([
      { name: 'rankStations', input: { metric: 'rate_covid' } },
      { name: 'searchStations', input: { query: '東京' } },
    ])
  })
})
