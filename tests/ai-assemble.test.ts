/**
 * src/ai/assemble：ツール副産物 → MapResponse の決定的組立（純関数・DB/LLM 不要）。
 * P8a 受け入れの要：組み立てた MapResponse が **必ず** mapResponseSchema を通ること
 * （パネルは domain ビルダ由来＝LLM は生成しない）＋ 地図操作・要約の正しさ。
 */

import { describe, expect, it } from 'vitest'
import { type StationRow } from '@/shared/api'
import { buildStationDetail } from '@/domain/stations/presenter'
import { buildRanking, type RankRawRow } from '@/domain/ranking/presenter'
import { buildGrowth, type ValueRow } from '@/domain/growth/presenter'
import { mapResponseSchema, panelSchema } from '@/shared/protocol'
import {
  assemble,
  mapActionsForEffect,
  panelsForGrowth,
  panelsForRanking,
  panelsForStationDetail,
  summarizePanels,
} from '@/ai/assemble'
import { type GrowthEffect, type RankingEffect, type StationDetailEffect } from '@/ai/types'

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
  levelComplete: true,
}

const values = new Map<string, number>([
  ['pax_2011', 920144],
  ['pax_2024', 1262604],
  ['rate_yoy', 7.3],
  ['rate_covid', -5.7],
  ['flag_yoy', 0],
  ['flag_covid', 1],
  ['pop_2015_1km', 90000],
  ['pop_2020_1km', 95000],
  ['pop_gr_2020_2015_1km', 5.5],
  ['pop_lowbase_2015_1km', 0],
])

const detail = buildStationDetail(station, values)

const popEffect: StationDetailEffect = {
  kind: 'stationDetail',
  detail,
  category: 'population',
  radiusM: 1000,
}
const paxEffect: StationDetailEffect = {
  kind: 'stationDetail',
  detail,
  category: null,
  radiusM: 1000,
}

const rankRows: RankRawRow[] = [
  {
    grp: '流山おおたかの森#0',
    stationName: '流山おおたかの森',
    prefecture: '千葉県',
    value: 12.3,
    flagValue: 0,
    rank: 1,
  },
  {
    grp: '柏の葉キャンパス#0',
    stationName: '柏の葉キャンパス',
    prefecture: '千葉県',
    value: 10.1,
    flagValue: 1,
    rank: 2,
  },
]
const rankingEffect: RankingEffect = {
  kind: 'ranking',
  response: buildRanking('pop_gr_2020_2015_1km', ['千葉県'], 'desc', rankRows, 2, 0),
}

const valueRows: ValueRow[] = [
  { grp: 'A#0', stationName: 'A駅', key: 'pop_gr_2020_2015_2km', value: 5 },
  { grp: 'A#0', stationName: 'A駅', key: 'rate_covid', value: -3 },
  { grp: 'B#0', stationName: 'B駅', key: 'pop_gr_2020_2015_2km', value: 8 },
  { grp: 'B#0', stationName: 'B駅', key: 'rate_covid', value: -6 },
]
const growthEffect: GrowthEffect = {
  kind: 'growth',
  response: buildGrowth(valueRows, 'pop_gr_2020_2015_2km', 'rate_covid', { prefectures: [] }),
}

describe('panelsForStationDetail', () => {
  it('駅カード → 焦点カテゴリのパネル（人口＝重ねチャート＋増減率表）', () => {
    const panels = panelsForStationDetail(popEffect)
    expect(panels[0]?.type).toBe('stationCard')
    expect(panels.map((panel) => panel.type)).toContain('trendChart')
    expect(panels.map((panel) => panel.type)).toContain('statTable')
  })

  it('すべて compact / inline（チャット内表示・⤢で昇格）', () => {
    for (const panel of panelsForStationDetail(popEffect)) {
      expect(panel.size).toBe('compact')
      expect(panel.placement).toBe('inline')
    }
  })

  it('category 省略（null）＝乗降客の概要：カード → 推移チャート', () => {
    expect(panelsForStationDetail(paxEffect).map((panel) => panel.type)).toEqual([
      'stationCard',
      'trendChart',
    ])
  })

  it('全パネルが panelSchema を満たす', () => {
    for (const panel of panelsForStationDetail(popEffect)) {
      expect(panelSchema.safeParse(panel).success).toBe(true)
    }
  })
})

describe('mapActionsForEffect', () => {
  it('駅詳細＝flyTo（駅座標）＋selectStation（grp・半径）', () => {
    expect(mapActionsForEffect(popEffect)).toEqual([
      { type: 'flyTo', lon: 139.767, lat: 35.681, zoom: 12 },
      { type: 'selectStation', grp: '東京#0', radiusM: 1000 },
    ])
  })

  it('ランキング＝上位駅をハイライト', () => {
    expect(mapActionsForEffect(rankingEffect)).toEqual([
      { type: 'highlightStations', grps: ['流山おおたかの森#0', '柏の葉キャンパス#0'] },
    ])
  })

  it('散布＝地図操作なし', () => {
    expect(mapActionsForEffect(growthEffect)).toEqual([])
  })
})

describe('panelsForRanking / panelsForGrowth', () => {
  it('ランキング → rankingTable（compact/inline）', () => {
    const panels = panelsForRanking(rankingEffect)
    expect(panels).toHaveLength(1)
    expect(panels[0]?.type).toBe('rankingTable')
    expect(panels[0]?.placement).toBe('inline')
  })

  it('散布 → scatter（clusterCount つき）', () => {
    const panels = panelsForGrowth(growthEffect)
    expect(panels[0]?.type).toBe('scatter')
    if (panels[0]?.type === 'scatter') expect(panels[0].points.length).toBe(2)
  })
})

describe('assemble', () => {
  it('複数の副産物と本文から MapResponse を組み立て、必ず Zod を通る', () => {
    const response = assemble([popEffect, rankingEffect], '東京駅の人口推移と千葉県の順位です。')
    expect(mapResponseSchema.safeParse(response).success).toBe(true)
    expect(response.messages).toEqual([
      { role: 'assistant', text: '東京駅の人口推移と千葉県の順位です。' },
    ])
    // 駅詳細のパネル群 + ランキングのパネル
    expect(response.panels.map((panel) => panel.type)).toContain('stationCard')
    expect(response.panels.map((panel) => panel.type)).toContain('rankingTable')
    // 地図操作は flyTo + selectStation + highlightStations
    expect(response.mapActions.map((action) => action.type)).toEqual([
      'flyTo',
      'selectStation',
      'highlightStations',
    ])
  })

  it('ツールを呼ばない／本文空でも妥当な MapResponse（空配列）', () => {
    const empty = assemble([], '')
    expect(mapResponseSchema.safeParse(empty).success).toBe(true)
    expect(empty).toEqual({ messages: [], mapActions: [], panels: [] })
  })

  it('本文は trim され、空なら messages は空', () => {
    expect(assemble([], '   ').messages).toEqual([])
    expect(assemble([], '  こんにちは  ').messages).toEqual([
      { role: 'assistant', text: 'こんにちは' },
    ])
  })

  it('全ツール種を混在させても Zod を通る（純加算の描画パス）', () => {
    const response = assemble([paxEffect, rankingEffect, growthEffect], '結果です。')
    expect(mapResponseSchema.safeParse(response).success).toBe(true)
    expect(response.panels.map((panel) => panel.type)).toContain('scatter')
  })
})

describe('summarizePanels', () => {
  it('駅カード・チャートの数値をパネルと同じ値で要約（文章とパネルがズレない）', () => {
    const summary = summarizePanels(panelsForStationDetail(popEffect))
    expect(summary).toContain('駅: 東京（東京都')
    expect(summary).toContain('人口') // トレンド or 表の見出し
  })

  it('ランキング要約は順位・駅名・整形値を含む', () => {
    const summary = summarizePanels(panelsForRanking(rankingEffect))
    expect(summary).toContain('1位 流山おおたかの森')
    expect(summary).toContain('⚠') // 2位は lown フラグ
  })
})
