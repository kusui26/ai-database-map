import { describe, expect, it } from 'vitest'
import { type Panel } from '@/shared/protocol'
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

/** data-map と ツール呼び出しを持つアシスタント応答を組み立てる。 */
function assistant(
  id: string,
  panels: readonly Panel[],
  toolInput: Record<string, unknown> = {},
  toolName = 'compareGrowth',
  toolOutput: Record<string, unknown> = {},
): ChatUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'ご覧ください' },
      { type: 'data-map', data: { messages: [], mapActions: [], panels: [...panels] } },
      {
        type: `tool-${toolName}`,
        toolCallId: `${id}-call`,
        state: 'output-available',
        input: toolInput,
        output: toolOutput,
      },
    ],
  }
}

const user = (id: string): ChatUIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: '質問' }],
})

/** 散布の昇格はカタログキーから復元されるため、ラベルではなくキーを渡す。 */
const SCATTER_INPUT = { x: 'pop_gr_2020_2015_2km', y: 'rate_covid' }

describe('canvasTargetOf（キャンバスに出す対象・260802）', () => {
  it('メッセージが無ければ null＝初期表示で地図を隠さない', () => {
    expect(canvasTargetOf([])).toBeNull()
  })

  it('テキストだけの回答では出さない', () => {
    expect(canvasTargetOf([user('u1'), assistant('a1', [])])).toBeNull()
  })

  it('駅詳細だけの回答では出さない（右ドロワーが担当する）', () => {
    const detail = assistant('a1', [stationCard], { grp: '東京#0' }, 'getStationDetail')
    expect(canvasTargetOf([detail])).toBeNull()
  })

  it('散布があればその昇格パラメータを返す', () => {
    // x/y はカタログのラベルからキーを逆引きするため、実在のキーを渡す
    const message = assistant('a1', [scatter], {
      x: 'pop_gr_2020_2015_2km',
      y: 'rate_covid',
      operators: ['東海旅客鉄道'],
      routeTypes: [1],
    })
    const target = canvasTargetOf([message])
    expect(target?.promotion.kind).toBe('scatter')
    expect(target?.key.startsWith('a1:')).toBe(true)
    if (target?.promotion.kind === 'scatter') {
      expect(target.promotion.operators).toEqual(['東海旅客鉄道'])
      expect(target.promotion.routeTypes).toEqual([1])
    }
  })

  it('ランキングも対象', () => {
    const message = assistant('a1', [ranking], { metric: 'pax_2024' }, 'rankStations')
    expect(canvasTargetOf([message])?.promotion.kind).toBe('ranking')
  })

  it('直近のアシスタント応答を見る（そのあとユーザー発言が来ても変わらない）', () => {
    const first = assistant('a1', [ranking], { metric: 'pax_2024' }, 'rankStations')
    const before = canvasTargetOf([first])
    expect(canvasTargetOf([first, user('u2')])?.key).toBe(before?.key)
  })

  it('複数の応答があれば最後の応答を採る', () => {
    const first = assistant('a1', [ranking], { metric: 'pax_2024' }, 'rankStations')
    const second = assistant('a2', [scatter], {
      x: 'pop_gr_2020_2015_2km',
      y: 'rate_covid',
    })
    expect(canvasTargetOf([first, second])?.promotion.kind).toBe('scatter')
  })

  it('key は「同じ図なら同じ・条件が変われば変わる」（開き直しの判定に使う）', () => {
    const base = assistant('a1', [scatter], { x: 'pop_gr_2020_2015_2km', y: 'rate_covid' })
    const same = assistant('a1', [scatter], { x: 'pop_gr_2020_2015_2km', y: 'rate_covid' })
    const filtered = assistant('a1', [scatter], {
      x: 'pop_gr_2020_2015_2km',
      y: 'rate_covid',
      operators: ['東海旅客鉄道'],
    })
    expect(canvasTargetOf([base])?.key).toBe(canvasTargetOf([same])?.key)
    expect(canvasTargetOf([base])?.key).not.toBe(canvasTargetOf([filtered])?.key)
  })

  it('回答が違えば（同じ条件でも）key は変わる', () => {
    const first = assistant('a1', [scatter], SCATTER_INPUT)
    const second = assistant('a2', [scatter], SCATTER_INPUT)
    expect(canvasTargetOf([first])?.key).not.toBe(canvasTargetOf([second])?.key)
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
