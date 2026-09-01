import { afterEach, describe, expect, it } from 'vitest'
import { type z } from 'zod'
import {
  MCP_TOOL_CONFIGS,
  mcpDescription,
  mcpIpStore,
  registerMcpTools,
  type McpToolRegistry,
  type McpToolResult,
} from '@/ai/mcp-tools'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { TOOL_SPECS, TOOL_SPEC_NAMES } from '@/ai/tool-specs'

/**
 * **MCP アダプタ**（`docs/260828_research_claude_auth.md` §4.2 PR-2）。
 *
 * 固定するのは、①名前が Claude の制約（ASCII・64 文字）に収まり Spec と 1:1 であること、
 * ②説明・スキーマの本体が Spec と**同一**であること（言うことを割らない）、
 * ③全ツールが読み取り専用として登録されること（確認なし実行・審査基準）、
 * ④上流（気象庁・国土地理院）を叩くツールのレート制限が他より厳しいこと、
 * ⑤登録の網羅とレート制限の実挙動（IP ごとに独立・再試行の案内つき）。
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
  })
})

describe('registerMcpTools（登録の網羅と中身）', () => {
  it('9 ツール＋カタログ resource を、Spec と同じスキーマで登録する', () => {
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
      // スキーマは Spec と**同一の参照**（Gemini と MCP でずれない）。
      expect(tool.config.inputSchema, key).toBe(TOOL_SPECS[key].inputSchema)
      expect(tool.config.description, key).toBe(mcpDescription(key))
      expect(tool.config.title, key).toBe(MCP_TOOL_CONFIGS[key].titleJa)
      // 全ツール読み取り専用（Claude が確認なしで実行できる・審査基準）。
      expect(tool.config.annotations.readOnlyHint, key).toBe(true)
      expect(tool.config._meta['anthropic/maxResultSizeChars'], key).toBe(
        MCP_TOOL_CONFIGS[key].maxResultSizeChars,
      )
    }
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
    // 副産物なしのツールは structuredContent も空の protocol 形。
    expect(result.structuredContent).toEqual({ panels: [], mapActions: [] })
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
