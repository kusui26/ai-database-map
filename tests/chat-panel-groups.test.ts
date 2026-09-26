/**
 * src/components/chat/panelGroups：チャット応答のパネルを効果グループに束ね、⤢ 昇格の条件を付ける（純関数）。
 *
 * 条件はサーバが図を生んだ副産物から作り、パネルと同じ並びで送る（data-promotions・`shared/promotion.ts`）。
 * 画面は束ねるだけで、推し量らない。以前はツール呼び出しとの照合で条件を推し量っていたので、
 * 同じ指標の図が 2 つあると両方とも最初の呼び出しの条件で開いた（2026-09-26）。
 */

import { describe, expect, it } from 'vitest'
import { requireEntry } from '@/shared/catalog'
import { type Panel } from '@/shared/protocol'
import { type PanelPromotion, type ScatterPromotion } from '@/shared/promotion'
import { buildPanelGroups } from '@/components/chat/panelGroups'

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
function scatter(title: string): Panel {
  return {
    type: 'scatter',
    title,
    xLabel: requireEntry('pop_gr_2020_2015_1km').labelJa,
    yLabel: requireEntry('rate_covid').labelJa,
    xUnit: '%',
    yUnit: '%',
    points: [],
    clusterCount: 0,
  }
}
const markdown: Panel = { type: 'markdown', body: 'こんにちは' }

const detailPromotion: PanelPromotion = { kind: 'detail', grp: '東京#0', category: 'population' }
const rankingPromotion: PanelPromotion = {
  kind: 'ranking',
  metricKey: 'pop_gr_2020_2015_1km',
  order: 'desc',
  prefectures: ['千葉県'],
  operators: [],
  routes: [],
  routeTypes: [],
  excludeLowN: true,
}
function scatterPromotion(operators: string[]): ScatterPromotion {
  return {
    kind: 'scatter',
    xKey: 'pop_gr_2020_2015_1km',
    yKey: 'rate_covid',
    prefectures: [],
    operators,
    routes: [],
    routeTypes: [1],
    excludeLowN: false,
  }
}

describe('buildPanelGroups：束ね方', () => {
  it('駅詳細（カード＋本文）を 1 グループに束ね、カードの条件を付ける（本文の条件は見ない）', () => {
    const groups = buildPanelGroups([stationCard, trend], [detailPromotion, null])
    expect(groups).toEqual([{ panels: [stationCard, trend], promotion: detailPromotion }])
  })

  it('ランキング・散布はそれぞれ 1 グループ', () => {
    const scatterPanel = scatter('散布')
    const groups = buildPanelGroups(
      [rankingTable, scatterPanel],
      [rankingPromotion, scatterPromotion([])],
    )
    expect(groups).toEqual([
      { panels: [rankingTable], promotion: rankingPromotion },
      { panels: [scatterPanel], promotion: scatterPromotion([]) },
    ])
  })

  it('複数の効果が混在しても境界を正しく分ける（詳細 → ランキング → 散布）', () => {
    const panels = [stationCard, trend, rankingTable, scatter('散布')]
    const promotions = [detailPromotion, null, rankingPromotion, scatterPromotion([])]
    const groups = buildPanelGroups(panels, promotions)
    expect(groups.map((group) => group.promotion?.kind)).toEqual(['detail', 'ranking', 'scatter'])
    expect(groups.map((group) => group.panels.length)).toEqual([2, 1, 1])
  })

  it('markdown 等の単独パネルは昇格なし', () => {
    expect(buildPanelGroups([markdown], [null])).toEqual([{ panels: [markdown], promotion: null }])
  })

  it('ランキングや散布のあとの単独パネルは、前のグループに混ぜない', () => {
    const groups = buildPanelGroups([rankingTable, markdown], [rankingPromotion, null])
    expect(groups.map((group) => group.panels.length)).toEqual([1, 1])
    expect(groups[1]?.promotion).toBeNull()
  })

  it('パネルが無ければグループも無い', () => {
    expect(buildPanelGroups([], [])).toEqual([])
  })
})

describe('buildPanelGroups：条件はサーバが付けたものだけを使う', () => {
  it('同じ指標の図が 2 つあっても、それぞれ自分の条件で開く（以前は両方とも最初の条件だった）', () => {
    // 本物の応答で起きた形：事業者名に「新幹線」を渡して 0 件の図 → 絞り込みを外して呼び直し、点のある図
    const empty = scatter('人口増減率 × 回復率（全国・新幹線・新幹線）')
    const retried = scatter('人口増減率 × 回復率（全国・新幹線）')
    const groups = buildPanelGroups(
      [empty, retried],
      [scatterPromotion(['新幹線']), scatterPromotion([])],
    )
    expect(groups.map((group) => group.promotion)).toEqual([
      scatterPromotion(['新幹線']),
      scatterPromotion([]),
    ])
  })

  it('条件の種類が先頭パネルと食い違えば昇格しない（別の図の条件で開かない）', () => {
    const groups = buildPanelGroups([rankingTable], [scatterPromotion([])])
    expect(groups[0]?.promotion).toBeNull()
  })

  it('条件の数がパネルと合わなければ、どれも使わない（添字のずれで別の図の条件を拾わない）', () => {
    const groups = buildPanelGroups(
      [rankingTable, scatter('散布')],
      [scatterPromotion([]), rankingPromotion, null],
    )
    expect(groups.map((group) => group.promotion)).toEqual([null, null])
  })

  it('条件が届いていなければ昇格しない（推し量らない）', () => {
    const groups = buildPanelGroups([stationCard, trend, rankingTable], [])
    expect(groups.map((group) => group.promotion)).toEqual([null, null])
  })
})
