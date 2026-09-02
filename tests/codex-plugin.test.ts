import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * **Codex プラグイン**（PR-8・`docs/260828_research_claude_auth.md` §4.5「PostHog 方式」）。
 *
 * 固定するのは、①`.codex-plugin/plugin.json` が公式スキーマの必須項目
 * （name/version/description/author/interface）を満たすこと、②版が Claude 側の
 * plugin.json と**同期**していること（片方だけ上がる事故を防ぐ）、③MCP は
 * **inline の素の URL**であること（Claude 用 .mcp.json の `${AIDB_MCP_URL:-…}` 展開は
 * Codex に無い前提で共有しない）、④マーケットプレイスの policy が許容値であること。
 */

const PLUGIN = 'plugins/ai-database-map/.codex-plugin/plugin.json'
const MARKETPLACE = '.agents/plugins/marketplace.json'
const CLAUDE_PLUGIN = 'plugins/ai-database-map/.claude-plugin/plugin.json'
const PROD_MCP_URL = 'https://ai-database-map.vercel.app/api/mcp'

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} がオブジェクトでない`)
  }
  return Object.fromEntries(Object.entries(parsed))
}

describe('.codex-plugin/plugin.json', () => {
  const plugin = readJson(PLUGIN)

  it('必須項目（name / version / description / author / interface）を満たす', () => {
    expect(plugin['name']).toBe('ai-database-map')
    expect(typeof plugin['version']).toBe('string')
    expect(String(plugin['description']).length).toBeGreaterThan(20)
    const author = plugin['author']
    if (typeof author !== 'object' || author === null) throw new Error('author 不正')
    expect('name' in author && author.name).toBe('kusui26')
    const ui = plugin['interface']
    if (typeof ui !== 'object' || ui === null) throw new Error('interface 不正')
    expect('displayName' in ui && ui.displayName).toBe('AI Database Map')
    expect('category' in ui && typeof ui.category === 'string').toBe(true)
  })

  it('版は Claude 側 plugin.json と同期している', () => {
    const claude = readJson(CLAUDE_PLUGIN)
    expect(plugin['version']).toBe(claude['version'])
  })

  it('skills は Claude と同じディレクトリを共有する', () => {
    expect(plugin['skills']).toBe('./skills/')
    expect(statSync('plugins/ai-database-map/skills').isDirectory()).toBe(true)
  })

  it('MCP は inline の素の URL（env 展開構文を含まない・本番を指す）', () => {
    const servers = plugin['mcpServers']
    if (typeof servers !== 'object' || servers === null || !('station-data' in servers)) {
      throw new Error('mcpServers.station-data が無い')
    }
    const server: unknown = servers['station-data']
    if (typeof server !== 'object' || server === null) throw new Error('server 不正')
    const url = 'url' in server && typeof server.url === 'string' ? server.url : ''
    expect(url).toBe(PROD_MCP_URL)
    expect(url.includes('${')).toBe(false)
    expect('type' in server && server.type).toBe('http')
  })

  it('defaultPrompt は 3 件以内・各 128 文字以内（公式スキーマの上限）', () => {
    const ui = plugin['interface']
    if (typeof ui !== 'object' || ui === null || !('defaultPrompt' in ui)) return
    const prompts: unknown = ui.defaultPrompt
    if (!Array.isArray(prompts)) throw new Error('defaultPrompt 不正')
    expect(prompts.length).toBeLessThanOrEqual(3)
    for (const prompt of prompts) {
      expect(typeof prompt).toBe('string')
      expect(String(prompt).length).toBeLessThanOrEqual(128)
    }
  })
})

describe('.agents/plugins/marketplace.json', () => {
  const marketplace = readJson(MARKETPLACE)

  it('プラグイン 1 件が実在パスを指し、policy が許容値', () => {
    const plugins: unknown = marketplace['plugins']
    if (!Array.isArray(plugins)) throw new Error('plugins が配列でない')
    expect(plugins.length).toBe(1)
    const entry: unknown = plugins[0]
    if (typeof entry !== 'object' || entry === null) throw new Error('entry 不正')
    const source = 'source' in entry ? entry.source : undefined
    if (typeof source !== 'object' || source === null) throw new Error('source 不正')
    expect('source' in source && source.source).toBe('local')
    const path = 'path' in source && typeof source.path === 'string' ? source.path : ''
    expect(statSync(path.replace('./', '')).isDirectory()).toBe(true)
    const policy = 'policy' in entry ? entry.policy : undefined
    if (typeof policy !== 'object' || policy === null) throw new Error('policy 不正')
    expect(
      'installation' in policy &&
        ['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(
          String(policy.installation),
        ),
    ).toBe(true)
    expect(
      'authentication' in policy &&
        ['ON_INSTALL', 'ON_USE'].includes(String(policy.authentication)),
    ).toBe(true)
  })
})
