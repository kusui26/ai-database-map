import { describe, expect, it } from 'vitest'
import { type Panel } from '@/shared/protocol'
import {
  type PanelPromotions,
  type RankingPromotion,
  type ScatterPromotion,
} from '@/shared/promotion'
import { type ChatUIMessage } from '@/components/chat/types'
import { canvasTargetOf } from '@/components/chat/canvasTarget'
import { chipLabel } from '@/components/chat/PanelChip'

const scatter: Panel = {
  type: 'scatter',
  title: '人口増減率 × 乗降客数 コロナ前後増減率（全国・東海旅客鉄道・新幹線）',
  xLabel: '人口増減率（2015→2020年・2km圏）',
  yLabel: '乗降客数 コロナ前後増減率',
  xUnit: '%',
  yUnit: '%',
  points: [],
  clusterCount: 1,
}

const ranking: Panel = {
  type: 'rankingTable',
  title: '乗降客数（2024年）（全国・上位）',
  metricKey: 'pax_2024',
  unit: '人/日',
  rows: [],
}

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

/** data-map と、サーバが付けた ⤢ の条件（data-promotions・パネルと同じ並び）を持つアシスタント応答。 */
function assistant(
  id: string,
  panels: readonly Panel[],
  promotions: PanelPromotions = panels.map(() => null),
): ChatUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'ご覧ください' },
      { type: 'data-promotions', data: [...promotions] },
      { type: 'data-map', data: { messages: [], mapActions: [], panels: [...panels] } },
    ],
  }
}

const user = (id: string): ChatUIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: '質問' }],
})

function scatterPromotion(
  filters: Partial<Pick<ScatterPromotion, 'prefectures' | 'operators' | 'routeTypes'>> = {},
): ScatterPromotion {
  return {
    kind: 'scatter',
    xKey: 'pop_gr_2020_2015_2km',
    yKey: 'rate_covid',
    prefectures: [],
    operators: [],
    routes: [],
    routeTypes: [],
    excludeLowN: false,
    ...filters,
  }
}

const rankingPromotion: RankingPromotion = {
  kind: 'ranking',
  metricKey: 'pax_2024',
  order: 'desc',
  prefectures: [],
  operators: [],
  routes: [],
  routeTypes: [],
  excludeLowN: false,
}

describe('canvasTargetOf（キャンバスに出す対象・260802）', () => {
  it('メッセージが無ければ null＝初期表示で地図を隠さない', () => {
    expect(canvasTargetOf([])).toBeNull()
  })

  it('テキストだけの回答では出さない', () => {
    expect(canvasTargetOf([user('u1'), assistant('a1', [])])).toBeNull()
  })

  it('駅詳細だけの回答では出さない（右ドロワーが担当する）', () => {
    const detail = assistant(
      'a1',
      [stationCard],
      [{ kind: 'detail', grp: '東京#0', category: null }],
    )
    expect(canvasTargetOf([detail])).toBeNull()
  })

  it('散布があれば、サーバが付けた条件で開く', () => {
    const promotion = scatterPromotion({ operators: ['東海旅客鉄道'], routeTypes: [1] })
    const target = canvasTargetOf([assistant('a1', [scatter], [promotion])])
    expect(target?.promotion).toEqual(promotion)
    expect(target?.key.startsWith('a1:')).toBe(true)
  })

  it('ランキングも対象', () => {
    const message = assistant('a1', [ranking], [rankingPromotion])
    expect(canvasTargetOf([message])?.promotion.kind).toBe('ranking')
  })

  it('直近のアシスタント応答を見る（そのあとユーザー発言が来ても変わらない）', () => {
    const first = assistant('a1', [ranking], [rankingPromotion])
    const before = canvasTargetOf([first])
    expect(canvasTargetOf([first, user('u2')])?.key).toBe(before?.key)
  })

  it('複数の応答があれば最後の応答を採る', () => {
    const first = assistant('a1', [ranking], [rankingPromotion])
    const second = assistant('a2', [scatter], [scatterPromotion()])
    expect(canvasTargetOf([first, second])?.promotion.kind).toBe('scatter')
  })

  it('key は「同じ図なら同じ・条件が変われば変わる」（開き直しの判定に使う）', () => {
    const base = assistant('a1', [scatter], [scatterPromotion()])
    const same = assistant('a1', [scatter], [scatterPromotion()])
    const filtered = assistant('a1', [scatter], [scatterPromotion({ operators: ['東海旅客鉄道'] })])
    expect(canvasTargetOf([base])?.key).toBe(canvasTargetOf([same])?.key)
    expect(canvasTargetOf([base])?.key).not.toBe(canvasTargetOf([filtered])?.key)
  })

  it('回答が違えば（同じ条件でも）key は変わる', () => {
    const first = assistant('a1', [scatter], [scatterPromotion()])
    const second = assistant('a2', [scatter], [scatterPromotion()])
    expect(canvasTargetOf([first])?.key).not.toBe(canvasTargetOf([second])?.key)
  })

  it('同じ指標の図が 2 つあれば、最後の図を**その図の**条件で開く（以前は最初の図の条件だった）', () => {
    // 本物の応答で起きた形：事業者名に「新幹線」を渡して 0 件の図 → 絞り込みを外して呼び直し、点のある図
    const empty = { ...scatter, title: '（全国・新幹線・新幹線）', clusterCount: 0 }
    const retried = { ...scatter, title: '（全国・新幹線）', clusterCount: 4 }
    const message = assistant(
      'a1',
      [empty, retried],
      [
        scatterPromotion({ operators: ['新幹線'], routeTypes: [1] }),
        scatterPromotion({ routeTypes: [1] }),
      ],
    )
    expect(canvasTargetOf([message])?.promotion).toEqual(scatterPromotion({ routeTypes: [1] }))
  })

  it('サーバの条件が届いていなければ開かない（推し量らない）', () => {
    expect(canvasTargetOf([assistant('a1', [scatter], [])])).toBeNull()
  })
})

describe('chipLabel（スレッドに残す参照チップの文言）', () => {
  it('図はタイトルをそのまま使う（絞り込み条件が入っている）', () => {
    expect(chipLabel([scatter])).toContain('東海旅客鉄道・新幹線')
    expect(chipLabel([ranking])).toBe('乗降客数（2024年）（全国・上位）')
  })

  it('駅詳細は駅名を出す', () => {
    expect(chipLabel([stationCard])).toBe('東京 の詳細')
  })

  it('markdown だけなら既定の文言（チップは出さない経路だが安全側）', () => {
    expect(chipLabel([{ type: 'markdown', body: 'こんにちは' }])).toBe('結果')
    expect(chipLabel([])).toBe('結果')
  })
})
