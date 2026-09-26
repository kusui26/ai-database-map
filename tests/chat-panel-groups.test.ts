/**
 * src/components/chat/panelGroups：チャット応答パネルの効果グループ化＋⤢昇格パラメータ導出（純関数）。
 * assemble の並び（駅詳細＝カード＋本文／ランキング／散布）を境界復元し、ツール入力と照合して
 * 昇格先パラメータ（都道府県・順序・x/y キー等）を忠実に復元できることを担保する。
 */

import { describe, expect, it } from 'vitest'
import { readUIMessageStream, type UIMessageChunk } from 'ai'
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
  { name: 'getStationDetail', output: {}, input: { grp: '東京#0', category: 'population' } },
  {
    name: 'rankStations',
    output: {},
    input: {
      metric: 'pop_gr_2020_2015_1km',
      prefectures: ['千葉県'],
      order: 'desc',
      excludeLowN: true,
    },
  },
  {
    name: 'compareGrowth',
    output: {},
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
      operators: [],
      routes: [],
      routeTypes: [],
      order: 'desc',
      excludeLowN: true,
    })
  })

  it('ランキングの運営会社・路線・種別も昇格パラメータに復元される（260801）', () => {
    const withFilters: ToolCall[] = [
      {
        name: 'rankStations',
        output: {},
        input: {
          metric: 'pop_gr_2020_2015_1km',
          operators: ['東海旅客鉄道'],
          routes: ['東海道新幹線'],
          routeTypes: [1, '2'],
          order: 'asc',
        },
      },
    ]
    const promotion = buildPanelGroups([rankingTable], withFilters)[0]?.promotion
    expect(promotion).toEqual({
      kind: 'ranking',
      metricKey: 'pop_gr_2020_2015_1km',
      prefectures: [],
      operators: ['東海旅客鉄道'],
      routes: ['東海道新幹線'],
      routeTypes: [1], // 文字列 '2' は型ガードで落ちる
      order: 'asc',
      excludeLowN: false,
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
      routes: [],
      routeTypes: [],
      excludeLowN: false,
    })
  })

  it('散布の運営会社フィルタも昇格パラメータに復元される（260730）', () => {
    const withOperators: ToolCall[] = [
      {
        name: 'compareGrowth',
        output: {},
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
      routes: [],
      routeTypes: [],
      excludeLowN: false,
    })
  })

  it('散布の路線・種別フィルタも昇格パラメータに復元される（260731）', () => {
    const withRoutes: ToolCall[] = [
      {
        name: 'compareGrowth',
        output: {},
        input: {
          x: 'pop_gr_2020_2015_2km',
          y: 'rate_covid',
          operators: ['東海旅客鉄道'],
          routes: ['東海道新幹線'],
          routeTypes: [1],
        },
      },
    ]
    const groups = buildPanelGroups([scatter], withRoutes)
    expect(groups[0]?.promotion).toEqual({
      kind: 'scatter',
      xKey: 'pop_gr_2020_2015_2km',
      yKey: 'rate_covid',
      prefectures: [],
      operators: ['東海旅客鉄道'],
      routes: ['東海道新幹線'],
      routeTypes: [1],
      excludeLowN: false,
    })
  })

  it('壊れた routeTypes（文字列・小数）は無視して昇格する（型ガード）', () => {
    const broken: ToolCall[] = [
      {
        name: 'compareGrowth',
        output: {},
        input: {
          x: 'pop_gr_2020_2015_2km',
          y: 'rate_covid',
          routes: ['東海道新幹線', 42],
          routeTypes: ['1', 1.5, 2],
        },
      },
    ]
    const promotion = buildPanelGroups([scatter], broken)[0]?.promotion
    expect(promotion?.kind === 'scatter' ? promotion.routes : null).toEqual(['東海道新幹線'])
    expect(promotion?.kind === 'scatter' ? promotion.routeTypes : null).toEqual([2])
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
      operators: [],
      routes: [],
      routeTypes: [],
      order: 'desc',
      excludeLowN: false,
    })
    const sc = buildPanelGroups([scatter], [])
    expect(sc[0]?.promotion).toBeNull()
  })
})

describe('toolCallsOf', () => {
  it('tool-<name> と dynamic-tool から名前＋入力＋出力を抽出する', () => {
    const parts = [
      { type: 'text', text: 'hi' },
      {
        type: 'tool-rankStations',
        input: { metric: 'pop_gr' },
        output: { resolvedMetric: 'pop_gr_2020_2015_1km' },
      },
      { type: 'dynamic-tool', toolName: 'searchStations', input: { query: '東京' } },
      { type: 'data-map' },
    ]
    expect(toolCallsOf(parts)).toEqual([
      {
        name: 'rankStations',
        input: { metric: 'pop_gr' },
        output: { resolvedMetric: 'pop_gr_2020_2015_1km' },
      },
      { name: 'searchStations', input: { query: '東京' }, output: {} },
    ])
  })
})

/**
 * LLM は指標を**ファミリ名**で渡してよい（system-prompt）。入力だけを見ていると
 * `getEntry('pop_gr')` が解決できず昇格が復元できないため、ツールの出力
 * （resolvedMetric / resolvedMetrics）を正として照合する（260802）。
 */
describe('ファミリ名で呼ばれた場合の昇格復元', () => {
  it('散布：出力の resolvedMetrics からキーを復元する', () => {
    const familyCall: ToolCall[] = [
      {
        name: 'compareGrowth',
        input: { x: 'pop_gr', y: 'rate_covid', radiusM: 2000 },
        output: { resolvedMetrics: { x: 'pop_gr_2020_2015_2km', y: 'rate_covid' } },
      },
    ]
    const promotion = buildPanelGroups([scatter], familyCall)[0]?.promotion
    expect(promotion?.kind).toBe('scatter')
    if (promotion?.kind === 'scatter') {
      expect(promotion.xKey).toBe('pop_gr_2020_2015_2km')
      expect(promotion.yKey).toBe('rate_covid')
    }
  })

  it('ランキング：出力の resolvedMetric で照合する', () => {
    const familyCall: ToolCall[] = [
      {
        name: 'rankStations',
        input: { metric: 'pop_gr', radiusM: 1000, prefectures: ['千葉県'] },
        output: { resolvedMetric: 'pop_gr_2020_2015_1km', prefectures: ['千葉県'], order: 'asc' },
      },
    ]
    const promotion = buildPanelGroups([rankingTable], familyCall)[0]?.promotion
    expect(promotion).toEqual({
      kind: 'ranking',
      metricKey: 'pop_gr_2020_2015_1km',
      prefectures: ['千葉県'],
      operators: [],
      routes: [],
      routeTypes: [],
      order: 'asc', // 出力（解決後）の並び順を採る
      excludeLowN: false,
    })
  })
})

/**
 * 失敗した呼び出しを ⤢ の照合に使わない（2026-09-26）。
 *
 * パーツは手で組まず、**サーバが送るのと同じチャンクの並び**（実物から採取）を、画面（useChat）と
 * 同じ組み立て（`readUIMessageStream`）に通して作る。手で組むと実物と形がずれる——実際、SDK が弾いた
 * 既知のツールの呼び出しは、引数を `input` ではなく `rawInput` に持つ。
 */
describe('失敗した呼び出しは ⤢ の照合に使わない', () => {
  const X = 'pop_gr_2020_2015_2km'
  const Y = 'rate_covid'
  const TOOL_FAILURE = 'ツールの呼び出しに失敗しました。'

  /** 実行まで進んだ呼び出し（成功でも、ツールが失敗を結果として返した場合でも同じ並び）。 */
  function executedCall(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
  ): UIMessageChunk[] {
    return [
      { type: 'tool-input-start', toolCallId, toolName },
      { type: 'tool-input-delta', toolCallId, inputTextDelta: JSON.stringify(input) },
      { type: 'tool-input-available', toolCallId, toolName, input },
      { type: 'tool-output-available', toolCallId, output },
    ]
  }

  /** 実行が投げた呼び出し（`input` を持ったまま失敗する）。 */
  function thrownCall(toolCallId: string, input: Record<string, unknown>): UIMessageChunk[] {
    return [
      { type: 'tool-input-start', toolCallId, toolName: 'compareGrowth' },
      { type: 'tool-input-available', toolCallId, toolName: 'compareGrowth', input },
      { type: 'tool-output-error', toolCallId, errorText: TOOL_FAILURE },
    ]
  }

  /** SDK が弾いた呼び出し（形の合わない引数）。 */
  function rejectedCall(toolCallId: string, input: Record<string, unknown>): UIMessageChunk[] {
    return [
      { type: 'tool-input-start', toolCallId, toolName: 'compareGrowth' },
      { type: 'tool-input-delta', toolCallId, inputTextDelta: JSON.stringify(input) },
      {
        type: 'tool-input-error',
        toolCallId,
        toolName: 'compareGrowth',
        input,
        errorText: TOOL_FAILURE,
      },
      { type: 'tool-output-error', toolCallId, errorText: TOOL_FAILURE },
    ]
  }

  /** 画面と同じ組み立てに通して、応答のパーツを得る。 */
  async function partsFrom(calls: readonly UIMessageChunk[]): Promise<readonly { type: string }[]> {
    const chunks: UIMessageChunk[] = [
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      ...calls,
      { type: 'finish-step' },
      { type: 'finish' },
    ]
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk))
        controller.close()
      },
    })
    const messages = await Array.fromAsync(readUIMessageStream({ stream }))
    return messages.at(-1)?.parts ?? []
  }

  /** 存在しない都道府県名。ツールは失敗を結果として返す（`tool-specs.ts` の構造化エラー）。 */
  const UNKNOWN_PREFECTURE = {
    error: '未知の都道府県: 千葉市',
    hint: '都道府県は正式名（例「神奈川県」「東京都」）で指定してください。',
  }

  it('散布：「千葉市」で失敗し「千葉県」で呼び直した → ⤢ は呼び直した方の条件で開く', async () => {
    const parts = await partsFrom([
      ...executedCall(
        'c1',
        'compareGrowth',
        { x: X, y: Y, prefectures: ['千葉市'] },
        UNKNOWN_PREFECTURE,
      ),
      ...executedCall(
        'c2',
        'compareGrowth',
        { x: X, y: Y, prefectures: ['千葉県'] },
        { resolvedMetrics: { x: X, y: Y }, prefectures: ['千葉県'], pointCount: 3 },
      ),
    ])
    const promotion = buildPanelGroups([scatter], toolCallsOf(parts))[0]?.promotion
    expect(promotion?.kind === 'scatter' ? promotion.prefectures : null).toEqual(['千葉県'])
  })

  it('ランキング：同じく、失敗を返した呼び出しの都道府県を使わない', async () => {
    const metric = 'pop_gr_2020_2015_1km'
    const parts = await partsFrom([
      ...executedCall(
        'c1',
        'rankStations',
        { metric, prefectures: ['千葉市'] },
        UNKNOWN_PREFECTURE,
      ),
      ...executedCall(
        'c2',
        'rankStations',
        { metric, prefectures: ['千葉県'] },
        { resolvedMetric: metric, prefectures: ['千葉県'], order: 'desc' },
      ),
    ])
    const promotion = buildPanelGroups([rankingTable], toolCallsOf(parts))[0]?.promotion
    expect(promotion?.kind === 'ranking' ? promotion.prefectures : null).toEqual(['千葉県'])
  })

  it('実行が投げた呼び出しは input を持ったまま失敗するので、状態で除く', async () => {
    const parts = await partsFrom([
      ...thrownCall('c1', { x: X, y: Y, operators: ['東日本旅客鉄道'] }),
      ...executedCall('c2', 'compareGrowth', { x: X, y: Y }, { resolvedMetrics: { x: X, y: Y } }),
    ])
    expect(parts.filter((part) => part.type === 'tool-compareGrowth')).toHaveLength(2)
    expect(toolCallsOf(parts)).toHaveLength(1)
    const promotion = buildPanelGroups([scatter], toolCallsOf(parts))[0]?.promotion
    expect(promotion?.kind === 'scatter' ? promotion.operators : null).toEqual([])
  })

  it('SDK が弾いた呼び出し（形の合わない引数）は、引数を rawInput に持つ。これも除く', async () => {
    const parts = await partsFrom(
      rejectedCall('c1', { x: X, y: Y, operators: ['新幹線'], routeTypes: ['1'] }),
    )
    // 画面の組み立ては、失敗した呼び出しの引数を input ではなく rawInput に置く
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-compareGrowth',
        state: 'output-error',
        input: undefined,
      }),
    )
    expect(toolCallsOf(parts)).toEqual([])
  })

  it('「該当 0 件」は失敗ではない（空の図を生んでいる）ので除かない', async () => {
    const zeroMatches = {
      resolvedMetrics: { x: X, y: Y },
      operators: ['新幹線'],
      pointCount: 0,
      clusterCount: 0,
      note: '半径1km（既定）・2015→2020年（既定）・該当が 0 件でした。',
    }
    const parts = await partsFrom(
      executedCall('c1', 'compareGrowth', { x: X, y: Y, operators: ['新幹線'] }, zeroMatches),
    )
    expect(toolCallsOf(parts)).toHaveLength(1)
  })

  it('実行中の呼び出しは残す（パネルは出力より先に届くので、その間は入力で照合する）', async () => {
    const parts = await partsFrom([
      { type: 'tool-input-start', toolCallId: 'c1', toolName: 'compareGrowth' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'compareGrowth',
        input: { x: X, y: Y },
      },
    ])
    expect(toolCallsOf(parts)).toEqual([
      { name: 'compareGrowth', input: { x: X, y: Y }, output: {} },
    ])
  })

  it('承認されなかった呼び出し（output-denied）も除く', () => {
    const denied = { type: 'tool-compareGrowth', state: 'output-denied', input: { x: X, y: Y } }
    expect(toolCallsOf([denied])).toEqual([])
  })
})
