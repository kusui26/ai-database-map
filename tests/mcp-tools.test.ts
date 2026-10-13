import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MCP_TOOL_CONFIGS,
  mcpDescription,
  mcpIpStore,
  presentersFor,
  registerMcpTools,
  type McpToolRegistry,
  type McpToolResult,
} from '@/ai/mcp-tools'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { TOOL_SPECS, TOOL_SPEC_NAMES } from '@/ai/tool-specs'
import { PANEL_FIXTURES, panelFixture } from './fixtures/panels'

/**
 * **MCP アダプタ**（`docs/260828_research_claude_auth.md` §4.2 PR-2）。
 *
 * 固定するのは、①名前が Claude の制約（ASCII・64 文字）に収まり Spec と 1:1 であること、
 * ②説明・スキーマの本体が Spec と**同一**であること（言うことを割らない）、
 * ③全ツールが読み取り専用として登録されること（確認なし実行・審査基準）、
 * ④上流（気象庁・国土地理院）を叩くツールのレート制限が他より厳しいこと、
 * ⑤登録の網羅とレート制限の実挙動（IP ごとに独立・再試行の案内つき）、
 * ⑥**MCP Apps（iframe）を出さない**こと——PR-11 で撤収した（`docs/260912_gui_chat_protocol.md`
 * 決定 11）。`ui://` リソースも `_meta.ui` も `map_probe` も戻ってこないことを固定する。
 * ⑦表示用パラメータ `present`（PR-12）が**数値パネルを返すツールにだけ**広告され、
 * **ドメインには届かない**こと。指定しなければ応答は従来と 1 バイトも変わらない。
 * ⑧アプリのチャットだけの引数 `inMapView`（「このあたり」＝利用者の地図の範囲・2026-10-09 B3）は、
 * 地図の無い MCP には**広告しない**こと。
 * ⑨**広告していない引数を黙って外さない**こと（2026-10-13）。SDK は広告した型で引数を検めるので、広告する型は
 * 知らない引数も通し（loose）、道具を呼ぶ前に見つけて、集計せずに理由と呼び直し方を返す。テストは SDK と同じく
 * 広告した型で検めてから呼ぶ（`callLikeSdk`）——以前のテストは生の引数で呼び、SDK が外すことを見ていなかった。
 */

/** 偽サーバ：登録内容を記録するだけ。`McpToolRegistry` をそのまま実装（キャスト不要）。 */
type RegisteredTool = {
  name: string
  config: {
    title: string
    description: string
    inputSchema: z.ZodTypeAny
    annotations: { readOnlyHint: boolean }
    _meta: Record<string, unknown>
  }
  callback: (input: unknown) => Promise<McpToolResult>
}

/** SDK と同じく、広告した型で引数を検めてから呼ぶ（strip なら知らない引数はここで外れる）。 */
function callLikeSdk(tool: RegisteredTool, args: unknown): Promise<McpToolResult> {
  return tool.callback(tool.config.inputSchema.parse(args))
}

/** 名前で登録済みの道具を引く。 */
function registered(name: string): RegisteredTool {
  const { tools, server } = fakeServer()
  registerMcpTools(server, 'http://localhost:3000')
  const tool = tools.find((each) => each.name === name)
  if (tool === undefined) throw new Error(`${name} が登録されていない`)
  return tool
}

/** `_meta.ui`（MCP Apps のビューア指定）の有無。撤収済みなので**常に無い**のが不変条件。 */
const hasUiMeta = (meta: Record<string, unknown>): boolean => 'ui' in meta

/** Zod オブジェクトの持つキー（`as` を使わず型ガードで取り出す）。 */
function shapeKeysOf(schema: z.ZodTypeAny): readonly string[] {
  if (!(schema instanceof z.ZodObject)) throw new Error('ZodObject ではありません')
  return Object.keys(schema.shape)
}

/** 先頭の content からテキストを取り出す（型ガード。共用体を黙って潰さない）。 */
function firstText(result: McpToolResult): string {
  const item = result.content[0]
  if (item === undefined || item.type !== 'text') {
    throw new Error(`text content ではありません: ${JSON.stringify(item)}`)
  }
  return item.text
}

function fakeServer(): { tools: RegisteredTool[]; resources: string[]; server: McpToolRegistry } {
  const tools: RegisteredTool[] = []
  const resources: string[] = []
  const server: McpToolRegistry = {
    registerTool: (name, config, callback) => {
      tools.push({ name, config, callback })
    },
    registerResource: (_name, uri) => {
      resources.push(uri)
    },
  }
  return { tools, resources, server }
}

afterEach(() => {
  resetRateLimitStore()
})

describe('名前と設定（Claude の制約・審査基準）', () => {
  it('全 Spec に 1:1 で MCP 名があり、snake_case・ASCII・64 文字以内・一意', () => {
    const names = TOOL_SPEC_NAMES.map((key) => MCP_TOOL_CONFIGS[key].mcpName)
    expect(new Set(names).size).toBe(TOOL_SPEC_NAMES.length)
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_]{1,64}$/)
    }
  })

  it('説明は Spec の日本語がそのまま本文で、英語 1 文が併記される', () => {
    for (const key of TOOL_SPEC_NAMES) {
      const description = mcpDescription(key)
      expect(description.startsWith(TOOL_SPECS[key].description), key).toBe(true)
      expect(description, key).toContain('\nEN: ')
    }
  })

  it('上流（気象庁・国土地理院）を叩くツールは、他より厳しい上限', () => {
    const upstream = [
      'getHazardAlerts',
      'findEvacuationSites',
      'findEscapeDirection',
      'getHazardAtPoint',
    ] as const
    for (const key of upstream) {
      expect(MCP_TOOL_CONFIGS[key].perMinute, key).toBeLessThanOrEqual(15)
    }
    expect(MCP_TOOL_CONFIGS.searchStations.perMinute).toBeGreaterThanOrEqual(30)
    // CSV 生成（重いクエリ＋URL 発行）も検索系より絞る（§4.4）。
    expect(MCP_TOOL_CONFIGS.buildDataset.perMinute).toBeLessThanOrEqual(10)
  })
})

describe('registerMcpTools（登録の網羅と中身）', () => {
  it('全ツール（Spec の名簿どおり）とカタログ resource だけを、Spec と同じ引数で登録する', () => {
    const { tools, resources, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000')

    expect(tools.map((tool) => tool.name)).toEqual(
      TOOL_SPEC_NAMES.map((key) => MCP_TOOL_CONFIGS[key].mcpName),
    )
    expect(resources).toEqual(['catalog://metrics'])

    for (const [index, key] of TOOL_SPEC_NAMES.entries()) {
      const tool = tools[index]
      expect(tool, key).toBeDefined()
      if (tool === undefined) continue
      // ドメインの引数は Spec と同じ（アプリのチャットだけの `inMapView` を除く）。
      // `chartable` のツールだけ、表示用の `present` が 1 つ増える。
      const specKeys = shapeKeysOf(TOOL_SPECS[key].inputSchema)
      const domainKeys = specKeys.filter((name) => name !== 'inMapView')
      const chartable = MCP_TOOL_CONFIGS[key].chartable === true
      expect(shapeKeysOf(tool.config.inputSchema), key).toEqual(
        chartable ? [...domainKeys, 'present'] : domainKeys,
      )
      // 知らない引数も通す（loose）——SDK に黙って外させず、道具の手前で断るため。広告する JSON Schema は
      // 余分な引数を許す宣言が足されるだけ（以前の strip も宣言なし＝許す）
      expect(
        z.toJSONSchema(tool.config.inputSchema, { io: 'input' }).additionalProperties,
        key,
      ).toEqual({})
      expect(tool.config.description, key).toBe(mcpDescription(key))
      expect(tool.config.title, key).toBe(MCP_TOOL_CONFIGS[key].titleJa)
      // 全ツール読み取り専用（Claude が確認なしで実行できる・審査基準）。
      expect(tool.config.annotations.readOnlyHint, key).toBe(true)
      expect(tool.config._meta['anthropic/maxResultSizeChars'], key).toBe(
        MCP_TOOL_CONFIGS[key].maxResultSizeChars,
      )
    }
  })

  it('MCP Apps は撤収済み——`_meta.ui` も `ui://` も `map_probe` も出さない', () => {
    const { tools, resources, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000')

    for (const tool of tools) {
      expect(hasUiMeta(tool.config._meta), tool.name).toBe(false)
    }
    expect(tools.some((tool) => tool.name === 'map_probe')).toBe(false)
    expect(resources.some((uri) => uri.startsWith('ui://'))).toBe(false)
  })

  it('表示用 `present` は、数値パネルを返す 4 ツールにだけ広告される', () => {
    const chartable = TOOL_SPEC_NAMES.filter((key) => MCP_TOOL_CONFIGS[key].chartable === true)
    // エリアの要約（B5d）は推移と内訳の図を ECharts にできる（要約そのものは表と文なので変換しない）。
    expect(chartable).toEqual([
      'getStationDetail',
      'getAreaSummary',
      'rankStations',
      'compareGrowth',
    ])
    // ハザード系・一覧・CSV には付けない（チャートにできるものが無い／危険度は図にしない）。
    for (const key of ['getHazardAtPoint', 'listStations', 'buildDataset'] as const) {
      expect(MCP_TOOL_CONFIGS[key].chartable, key).not.toBe(true)
    }
  })

  it('「このあたり」（inMapView）は、Spec にはあるが MCP には広告しない（地図が無い・B3）', () => {
    const { tools, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000')
    const keys = ['rankStations', 'compareGrowth', 'listStations'] as const
    for (const key of keys) {
      expect(shapeKeysOf(TOOL_SPECS[key].inputSchema), key).toContain('inMapView')
      const tool = tools.find((registered) => registered.name === MCP_TOOL_CONFIGS[key].mcpName)
      if (tool === undefined) throw new Error(`${key} が登録されていない`)
      expect(shapeKeysOf(tool.config.inputSchema), key).not.toContain('inMapView')
      // ほかの場所の条件（市区町村・範囲・起点）は MCP でも使える
      expect(shapeKeysOf(tool.config.inputSchema), key).toEqual(
        expect.arrayContaining(['municipality', 'bbox', 'near']),
      )
    }
    // データセット（MCP だけ）の対象集合には、はじめから足さない（アプリのチャットに出していない）
    const dataset = TOOL_SPECS.buildDataset.inputSchema.shape.stations.unwrap()
    expect(shapeKeysOf(dataset)).not.toContain('inMapView')
  })

  it('エリアの要約の areas[].inMapView も、Spec にはあるが MCP には広告しない（入れ子・B5d）', () => {
    const { tools, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000')
    const area = TOOL_SPECS.getAreaSummary.inputSchema.shape.areas.element
    expect(shapeKeysOf(area)).toContain('inMapView')
    const tool = tools.find((registered) => registered.name === 'get_area_summary')
    if (tool === undefined) throw new Error('get_area_summary が登録されていない')
    const schema = tool.config.inputSchema
    if (!(schema instanceof z.ZodObject)) throw new Error('ZodObject ではありません')
    const areas = schema.shape.areas
    if (!(areas instanceof z.ZodArray)) throw new Error('areas が配列ではありません')
    const element = areas.element
    if (!(element instanceof z.ZodObject))
      throw new Error('areas の要素が ZodObject ではありません')
    expect(shapeKeysOf(element)).toEqual(['prefecture', 'municipality', 'line', 'widthM', 'near'])
    // ほかの引数と、図を返す道具の present はそのまま
    expect(shapeKeysOf(schema)).toEqual(['areas', 'colorBy', 'radiusM', 'present'])
  })

  it('MCP に inMapView が送られてきたら、黙って外さず、集計せずに理由と呼び直し方を返す（B3・2026-10-13）', async () => {
    // 以前は SDK が外し、地図の範囲で絞ったつもりのまま全国で集計していた（本番ビルドの MCP で確かめた）
    const result = await callLikeSdk(registered('rank_stations'), {
      metric: 'pop_gr',
      inMapView: true,
    })
    expect(result.isError).toBe(true)
    const text = firstText(result)
    expect(text).toContain('広告していない引数があります（inMapView）')
    expect(text).toContain('集計していません')
    // 呼び直し方：MCP には地図が無い・範囲なら bbox
    expect(text).toContain('MCP の呼び出しには地図が無い')
    expect(text).toContain('bbox')
  })

  it('名前の書き違い（prefectures を prefecture）も断り、その場所で使える引数を返す', async () => {
    const result = await callLikeSdk(registered('rank_stations'), {
      metric: 'pop_gr',
      prefecture: '東京都',
    })
    expect(result.isError).toBe(true)
    const parsed: unknown = JSON.parse(firstText(result))
    expect(parsed).toMatchObject({
      unknownArgs: [{ arg: 'prefecture', usable: expect.arrayContaining(['prefectures', 'bbox']) }],
    })
  })

  it('答えを変えない引数は見逃す：図を返せない道具への present・値が false や null の引数', async () => {
    const result = await callLikeSdk(registered('get_metrics_catalog'), {
      present: 'echarts',
      inMapView: false,
      note: null,
    })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).not.toContain('広告していない引数')
  })

  it('`present` はドメインへ届かない（Spec の Zod が落とす）', () => {
    const parsed: unknown = TOOL_SPECS.rankStations.inputSchema.parse({
      metric: 'pop_gr',
      present: 'echarts',
    })
    expect(parsed).not.toHaveProperty('present')
  })

  it('チャートにならないツールでは `present` を指定しても応答が変わらない', async () => {
    const { tools, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000')
    const catalog = tools.find((tool) => tool.name === 'get_metrics_catalog')
    if (catalog === undefined) throw new Error('get_metrics_catalog が登録されていない')
    const plain = await catalog.callback({})
    const asked = await catalog.callback({ present: 'echarts' })
    expect(asked.structuredContent).toEqual(plain.structuredContent)
    expect(asked.structuredContent).not.toHaveProperty('presenters')
  })

  it('カタログツールは実行でき、text は Gemini と同じ要約 JSON', async () => {
    const { tools, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000')
    const catalog = tools.find((tool) => tool.name === 'get_metrics_catalog')
    expect(catalog).toBeDefined()
    if (catalog === undefined) return
    const result = await catalog.callback({})
    expect(result.isError).toBeUndefined()
    const viaSpec = await TOOL_SPECS.getMetricsCatalog.run(
      { category: undefined, baseMetric: undefined },
      { origin: 'http://localhost:3000' },
    )
    expect(firstText(result)).toBe(JSON.stringify(viaSpec.forLlm))
    // structuredContent は**残す**——MCP Apps の iframe は撤収したが、パネルと地図操作は
    // 母艦のプレゼンタ／ビューア・プラグインが読む「型つきデータ」そのもの（決定 12）。
    // result（LLM 向け要約）も載せる——structuredContent を優先するクライアント
    // （Claude Code）でも空に見えないように（260903 の実走 eval で発見）。
    expect(result.structuredContent).toEqual({
      result: viaSpec.forLlm,
      panels: [],
      mapActions: [],
    })
  })

  it('入力は Spec と同一の Zod で検証される（未知の形は実行前に弾く）', async () => {
    const { tools, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000')
    const search = tools.find((tool) => tool.name === 'search_stations')
    if (search === undefined) throw new Error('search_stations が登録されていない')
    // query が無い入力 → parse が投げ、errorFallbackJa 系の isError で返る（DB には行かない）。
    const result = await search.callback({})
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('error')
  })

  it('ツール別レート制限：上限を超えると isError で「いつ再試行するか」を返す', async () => {
    const { tools, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000', {
      perMinuteOverrides: { getMetricsCatalog: 2 },
    })
    const catalog = tools.find((tool) => tool.name === 'get_metrics_catalog')
    if (catalog === undefined) throw new Error('get_metrics_catalog が登録されていない')
    await mcpIpStore.run('198.51.100.7', async () => {
      const first = await catalog.callback({})
      const second = await catalog.callback({})
      const third = await catalog.callback({})
      expect(first.isError).toBeUndefined()
      expect(second.isError).toBeUndefined()
      expect(third.isError).toBe(true)
      expect(firstText(third)).toContain('秒待ってから再試行')
      expect(firstText(third)).toContain('Rate limited')
    })
  })

  it('レート制限は IP ごとに独立（別 IP は巻き添えにならない）', async () => {
    const { tools, server } = fakeServer()
    registerMcpTools(server, 'http://localhost:3000', {
      perMinuteOverrides: { getMetricsCatalog: 1 },
    })
    const catalog = tools.find((tool) => tool.name === 'get_metrics_catalog')
    if (catalog === undefined) throw new Error('get_metrics_catalog が登録されていない')
    await mcpIpStore.run('203.0.113.1', () => catalog.callback({}))
    const blocked = await mcpIpStore.run('203.0.113.1', () => catalog.callback({}))
    const other = await mcpIpStore.run('203.0.113.2', () => catalog.callback({}))
    expect(blocked.isError).toBe(true)
    expect(other.isError).toBeUndefined()
  })
})

describe('presentersFor（表示用プレゼンタの出口・PR-12）', () => {
  it('要求されていなければ何も足さない（既定の応答は従来どおり）', () => {
    expect(presentersFor(null, PANEL_FIXTURES)).toBeNull()
  })

  it('チャートが 1 枚も作れなければ足さない（空の図を開かせない）', () => {
    expect(presentersFor('echarts', [])).toBeNull()
    expect(presentersFor('echarts', [panelFixture('hazardCard')])).toBeNull()
  })

  it('作れるときは `echarts` の document を足す（presentChart にそのまま渡せる形）', () => {
    const presenters = presentersFor('echarts', [panelFixture('rankingTable')])
    expect(presenters).not.toBeNull()
    if (presenters === null) return
    expect(presenters.echarts.charts.length).toBe(1)
    expect(presenters.echarts.charts[0]?.type).toBe('bar')
  })
})
