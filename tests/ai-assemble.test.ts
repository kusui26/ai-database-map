/**
 * src/ai/assemble：ツール副産物 → MapResponse の決定的組立（純関数・DB/LLM 不要）。
 * P8a 受け入れの要：組み立てた MapResponse が **必ず** mapResponseSchema を通ること
 * （パネルは domain ビルダ由来＝LLM は生成しない）＋ 地図操作・要約の正しさ。
 */

import { describe, expect, it } from 'vitest'
import { type StationRow } from '@/shared/api'
import { buildStationDetail } from '@/domain/stations/presenter'
import { buildRanking, type RankRawRow } from '@/domain/ranking/presenter'
import { buildGrowth, type ScatterRow } from '@/domain/growth/presenter'
import { mapResponseSchema, panelSchema } from '@/shared/protocol'
import {
  assemble,
  mapActionsForEffect,
  panelsForGrowth,
  panelsForHazardPoint,
  panelsForRanking,
  panelsForStationDetail,
  summarizePanels,
  textOrFallback,
} from '@/ai/assemble'
import { pointHazard } from '@/domain/hazard/point'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { type HazardPointEffect } from '@/ai/types'
import {
  createCollector,
  type GrowthEffect,
  type RankingEffect,
  type StationDetailEffect,
  type ToolEffect,
} from '@/ai/types'

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

const valueRows: ScatterRow[] = [
  { grp: 'A#0', stationName: 'A駅', x: 5, y: -3, xFlag: null, yFlag: null },
  { grp: 'B#0', stationName: 'B駅', x: 8, y: -6, xFlag: null, yFlag: null },
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

/**
 * fail-soft（docs/260728_chat_scatter_plot_timeout_mitigation.md フェーズ1）：
 * 中断・エラー・ステップ上限のいずれでも「無言の応答」にしない。
 */
describe('textOrFallback', () => {
  it('本文があればそのまま返す（前後の空白は落とす）', () => {
    expect(textOrFallback('  結果です。 ', 3, 'aborted')).toBe('結果です。')
    expect(textOrFallback('結果です。', 0, 'failed')).toBe('結果です。')
  })

  it('本文が空でパネルがあるときは「表示した」ことを伝える', () => {
    for (const outcome of ['ok', 'aborted', 'failed'] as const) {
      const text = textOrFallback('', 2, outcome)
      expect(text.length).toBeGreaterThan(0)
      expect(text).toContain('表示しました')
    }
    expect(textOrFallback('', 1, 'aborted')).toContain('時間内')
  })

  it('本文もパネルも無いときは再試行を促す（終わり方で文言が変わる）', () => {
    expect(textOrFallback('', 0, 'aborted')).toContain('時間内に取得できませんでした')
    expect(textOrFallback('', 0, 'failed')).toContain('時間をおいて')
    expect(textOrFallback('', 0, 'ok')).toContain('指標や地域を変えて')
  })

  it('空白のみの本文はフォールバックに置き換える', () => {
    expect(textOrFallback('   \n ', 0, 'ok')).toContain('うまく取得できませんでした')
  })

  it('outcome 省略時は通常終了（ok）として扱う', () => {
    expect(textOrFallback('', 0)).toBe(textOrFallback('', 0, 'ok'))
  })

  it('フォールバック文を入れた MapResponse も Zod を通る', () => {
    const response = assemble([growthEffect], textOrFallback('', 1, 'aborted'))
    expect(mapResponseSchema.safeParse(response).success).toBe(true)
    expect(response.messages).toHaveLength(1)
  })
})

describe('createCollector（部分成果の通知フック）', () => {
  it('push のたびに「その時点の全副産物」を通知する', () => {
    const snapshots: (readonly ToolEffect[])[] = []
    const collector = createCollector((effects) => snapshots.push(effects))
    collector.push(paxEffect)
    collector.push(rankingEffect)
    collector.push(growthEffect)
    expect(snapshots.map((snapshot) => snapshot.length)).toEqual([1, 2, 3])
    expect(snapshots[2]?.map((effect) => effect.kind)).toEqual([
      'stationDetail',
      'ranking',
      'growth',
    ])
  })

  it('通知されるのはスナップショット（後続の push で過去の通知が変わらない）', () => {
    const snapshots: (readonly ToolEffect[])[] = []
    const collector = createCollector((effects) => snapshots.push(effects))
    collector.push(rankingEffect)
    collector.push(growthEffect)
    expect(snapshots[0]).toHaveLength(1) // 2 回目の push で 1 回目の通知が伸びない
    expect(collector.drain()).toHaveLength(2)
  })

  it('通知された副産物からパネルを組み立てられる（途中で中断しても描ける）', () => {
    const partials: number[] = []
    const collector = createCollector((effects) =>
      partials.push(assemble(effects, '').panels.length),
    )
    collector.push(growthEffect)
    expect(partials[0]).toBeGreaterThan(0)
  })

  it('フックなしでも従来どおり動く（後方互換）', () => {
    const collector = createCollector()
    collector.push(growthEffect)
    expect(collector.drain()).toHaveLength(1)
  })
})

describe('assemble: 地点ハザード（Phase 4 前半・§6.5）', () => {
  /** 亀有駅で洪水（想定最大規模・計画規模）と家屋倒壊に当たった状態。 */
  function hazardEffect(): HazardPointEffect {
    const point = pointHazard(
      {
        lon: 139.847,
        lat: 35.7645,
        placeJa: '亀有駅',
        mesh: [],
        tile: [
          { layerKey: 'flood_l2', hex: '#FFB7B7' },
          { layerKey: 'flood_l1', hex: '#FFD8C0' },
          { layerKey: 'flood_kaoku_hanran', hex: '#FF0000' },
        ],
        rivers: [{ nameJa: '荒川', maxDepthM: 3.66, arriveMin: 162, continueMin: 5283 }],
        elevationM: 0.2,
        online: true,
        notesJa: [],
      },
      hazardLayersWithPointAnswer(),
    )
    return { kind: 'hazardPoint', point }
  }

  it('hazardCard パネルを 1 枚出し、Zod を通る', () => {
    const panels = panelsForHazardPoint(hazardEffect())
    expect(panels).toHaveLength(1)
    expect(panels[0]?.type).toBe('hazardCard')
    expect(() => panelSchema.parse(panels[0])).not.toThrow()
  })

  it('地点を指し、当たったレイヤを地図に出す（カードだけでは面が見えない）', () => {
    const actions = mapActionsForEffect(hazardEffect())
    const point = actions.find((action) => action.type === 'showPoint')
    expect(point).toMatchObject({ lon: 139.847, lat: 35.7645, labelJa: '亀有駅' })
    const layers = actions.find((action) => action.type === 'setHazardLayers')
    expect(layers?.type === 'setHazardLayers' && layers.layers).toEqual(
      expect.arrayContaining(['flood_l2', 'flood_kaoku_hanran']),
    )
    // 同じグループの base は 1 つだけ（想定最大規模と計画規模を重ねない）。
    expect(layers?.type === 'setHazardLayers' && layers.layers).not.toContain('flood_l1')
  })

  it('該当ゼロなら setHazardLayers を送らない（利用者のレイヤを勝手に消さない）', () => {
    const empty: HazardPointEffect = {
      kind: 'hazardPoint',
      point: pointHazard(
        {
          lon: 139.2438,
          lat: 35.6252,
          placeJa: '高尾山',
          mesh: [],
          tile: [],
          rivers: [],
          elevationM: 556,
          online: true,
          notesJa: [],
        },
        hazardLayersWithPointAnswer(),
      ),
    }
    const types = mapActionsForEffect(empty).map((action) => action.type)
    expect(types).toEqual(['showPoint']) // 空配列は「すべて消す」の意味なので送らない
  })

  it('MapResponse として組み上がる（LLM は数値もパネルも作らない）', () => {
    const response = assemble([hazardEffect()], 'この場所は浸水想定区域に入っています。')
    expect(() => mapResponseSchema.parse(response)).not.toThrow()
    expect(response.panels.map((panel) => panel.type)).toEqual(['hazardCard'])
  })

  it('LLM 向けの要約は、サーバが決めた結論と行動をそのまま運ぶ', () => {
    const summary = summarizePanels(panelsForHazardPoint(hazardEffect()))
    expect(summary).toContain('亀有駅')
    expect(summary).toContain('critical') // 家屋倒壊等氾濫想定区域
    expect(summary).toContain('takeaway') // 立退き避難
    expect(summary).not.toContain('安全')
  })
})
