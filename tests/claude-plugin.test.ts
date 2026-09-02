import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MCP_TOOL_CONFIGS } from '@/ai/mcp-tools'
import { TOOL_SPEC_NAMES } from '@/ai/tool-specs'

/**
 * **Claude Code プラグイン**（`docs/260828_research_claude_auth.md` §4.5 PR-3）。
 *
 * 固定するのは、①マニフェスト類が壊れていないこと、②スキル・エージェントが参照する
 * **完全修飾ツール名が実在すること**（`mcp__plugin_<plugin>_<server>__<tool>`——
 * 打ち間違いは実行時に「tool not found」で静かに壊れる）、③知識型スキルが
 * claude.ai/Cowork でハードエラーになる Claude Code 専用フィールドを使っていないこと。
 * マニフェストの網羅的な検証は CI の `claude plugin validate --strict` が担う。
 */

const ROOT = 'plugins/ai-database-map'
const SERVER_KEY = 'station-data'
const PLUGIN_NAME = 'ai-database-map'

function frontmatterOf(path: string): Record<string, string> {
  const source = readFileSync(path, 'utf-8')
  const match = source.match(/^---\n([\s\S]*?)\n---/)
  if (match === null || match[1] === undefined) throw new Error(`frontmatter が無い: ${path}`)
  const entries = match[1]
    .split('\n')
    .filter((line) => /^[a-z-]+:/.test(line))
    .map((line) => {
      const at = line.indexOf(':')
      return [line.slice(0, at), line.slice(at + 1).trim()]
    })
  return Object.fromEntries(entries)
}

describe('マニフェスト', () => {
  it('marketplace.json：source のディレクトリが実在し、名前が一致する', () => {
    const marketplace: unknown = JSON.parse(
      readFileSync('.claude-plugin/marketplace.json', 'utf-8'),
    )
    if (typeof marketplace !== 'object' || marketplace === null) throw new Error('形式不正')
    const plugins = 'plugins' in marketplace ? marketplace.plugins : undefined
    if (!Array.isArray(plugins)) throw new Error('plugins が配列でない')
    expect(plugins.length).toBe(1)
    const entry: unknown = plugins[0]
    if (typeof entry !== 'object' || entry === null) throw new Error('plugin entry 不正')
    const source = 'source' in entry && typeof entry.source === 'string' ? entry.source : ''
    expect(source).toBe(`./${ROOT}`)
    expect(statSync(source.replace('./', '')).isDirectory()).toBe(true)
  })

  it('plugin.json：名前・版・MCP 参照が正しい', () => {
    const plugin: unknown = JSON.parse(readFileSync(`${ROOT}/.claude-plugin/plugin.json`, 'utf-8'))
    if (typeof plugin !== 'object' || plugin === null) throw new Error('形式不正')
    const name = 'name' in plugin && typeof plugin.name === 'string' ? plugin.name : ''
    const version = 'version' in plugin && typeof plugin.version === 'string' ? plugin.version : ''
    const mcp =
      'mcpServers' in plugin && typeof plugin.mcpServers === 'string' ? plugin.mcpServers : ''
    expect(name).toBe(PLUGIN_NAME)
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(mcp).toBe('./.mcp.json')
    expect(statSync(`${ROOT}/.mcp.json`).isFile()).toBe(true)
  })

  it('.mcp.json：station-data が remote http で、本番 /api/mcp を既定にする', () => {
    const config: unknown = JSON.parse(readFileSync(`${ROOT}/.mcp.json`, 'utf-8'))
    if (typeof config !== 'object' || config === null || !('mcpServers' in config))
      throw new Error('形式不正')
    const servers: unknown = config.mcpServers
    if (typeof servers !== 'object' || servers === null || !(SERVER_KEY in servers))
      throw new Error(`${SERVER_KEY} が無い`)
    // `in` ナローイングで Record<'station-data', unknown> に絞る（as キャスト禁止）。
    const server: unknown = servers[SERVER_KEY]
    if (typeof server !== 'object' || server === null) throw new Error('server 不正')
    const type = 'type' in server && typeof server.type === 'string' ? server.type : ''
    const url = 'url' in server && typeof server.url === 'string' ? server.url : ''
    expect(type).toBe('http')
    expect(url).toContain('https://ai-database-map.vercel.app/api/mcp')
  })
})

describe('完全修飾ツール名（打ち間違いは静かに壊れる）', () => {
  const validNames = new Set(TOOL_SPEC_NAMES.map((key) => MCP_TOOL_CONFIGS[key].mcpName))
  const prefix = `mcp__plugin_${PLUGIN_NAME}_${SERVER_KEY}__`

  function pluginTextFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(md|json|sh)$/.test(entry.name))
      .map((entry) => `${entry.parentPath}/${entry.name}`)
  }

  it('スキル・エージェントが参照するツール名は、すべて実在の MCP 名', () => {
    const referenced = new Set<string>()
    for (const path of pluginTextFiles(ROOT)) {
      const source = readFileSync(path, 'utf-8')
      for (const match of source.matchAll(/mcp__plugin_[a-z0-9-]+_[a-z0-9-]+__([a-z0-9_]+)/g)) {
        const whole = match[0]
        const tool = match[1] ?? ''
        expect(whole.startsWith(prefix), `${path}: ${whole}`).toBe(true)
        expect(validNames.has(tool), `${path}: ${tool}`).toBe(true)
        referenced.add(tool)
      }
    }
    // 主要ツールはどこかから参照されている（導線の欠落を検知）。
    for (const key of [
      'search_stations',
      'rank_stations',
      'get_metrics_catalog',
      'build_dataset',
      'get_hazard_summary',
    ]) {
      expect(referenced.has(key), key).toBe(true)
    }
  })

  it('サブエージェントの tools は全ツール（TOOL_SPEC_NAMES と同数）', () => {
    const front = frontmatterOf(`${ROOT}/agents/data-analyst.md`)
    const tools = (front['tools'] ?? '').split(',').map((name) => name.trim())
    expect(tools.length).toBe(TOOL_SPEC_NAMES.length)
    for (const name of validNames) {
      expect(tools).toContain(`${prefix}${name}`)
    }
  })
})

describe('スキルの互換性（claude.ai / Cowork でハードエラーにしない）', () => {
  const STANDARD_KEYS = new Set([
    'name',
    'description',
    'license',
    'compatibility',
    'metadata',
    'allowed-tools',
  ])

  it('知識型スキルは標準フィールドだけ（アップロード互換）', () => {
    for (const skill of [
      'station-analysis',
      'hazard-reading',
      'analyze-csv',
      'station-recommendation',
      'transport-planning',
      'market-analysis',
    ]) {
      const front = frontmatterOf(`${ROOT}/skills/${skill}/SKILL.md`)
      for (const key of Object.keys(front)) {
        expect(STANDARD_KEYS.has(key), `${skill}: ${key}`).toBe(true)
      }
      expect(front['name']).toBe(skill)
      expect((front['description'] ?? '').length).toBeGreaterThan(20)
    }
  })

  it('コマンド型スキルは argument-hint を持ち、name がディレクトリ名と一致', () => {
    for (const skill of ['station', 'rank', 'recommend', 'demand', 'market']) {
      const front = frontmatterOf(`${ROOT}/skills/${skill}/SKILL.md`)
      expect(front['name']).toBe(skill)
      expect((front['argument-hint'] ?? '').length).toBeGreaterThan(0)
    }
  })

  it('分析の型（共通骨格）が station-analysis に一枚岩で明文化されている', () => {
    const skill = readFileSync(`${ROOT}/skills/station-analysis/SKILL.md`, 'utf-8')
    expect(skill).toContain('分析の型')
    expect(skill).toContain('ツールより先')
    expect(skill).toContain('既定を宣言して')
    expect(skill).toContain('正規化')
    expect(skill).toContain('線形加点しない')
    expect(skill).toContain('±20%')
    expect(skill).toContain('代表点')
    expect(skill).toContain('出典')
    expect(skill).toContain('preview')
  })

  it('用途レシピは型のダイジェストを持つ（骨格が読み込まれなくても崩れない）', () => {
    for (const skill of ['station-recommendation', 'transport-planning', 'market-analysis']) {
      const source = readFileSync(`${ROOT}/skills/${skill}/SKILL.md`, 'utf-8')
      expect(source, skill).toContain('分析の型')
      expect(source, skill).toContain('既定を宣言して')
      expect(source, skill).toContain('±20%')
      expect(source, skill).toContain('出典')
    }
  })

  it('おすすめ駅の方法論に §11 チェックリストの核が明文化されている', () => {
    const skill = readFileSync(`${ROOT}/skills/station-recommendation/SKILL.md`, 'utf-8')
    // ①好みを先に聞く ④正規化 ⑤ハザード非線形・「安全」禁止 ⑥敏感度 ⑦限界（代理・代表点）と出典
    expect(skill).toContain('ツールより先')
    expect(skill).toContain('正規化')
    expect(skill).toContain('線形')
    expect(skill).toContain('「安全です」とは書かない')
    expect(skill).toContain('±20%')
    expect(skill).toContain('マンション価格そのものではない')
    expect(skill).toContain('代表点')
    expect(skill).toContain('出典')
    expect(skill).toContain('uncovered')
  })

  it('輸送計画の方法論に「持っていないデータへの踏み込み禁止」が明文化されている', () => {
    const skill = readFileSync(`${ROOT}/skills/transport-planning/SKILL.md`, 'utf-8')
    expect(skill).toContain('断面輸送量')
    expect(skill).toContain('混雑率')
    expect(skill).toContain('持っていない')
    expect(skill).toContain('断定しない')
    expect(skill).toContain('出典')
  })

  it('商圏分析の方法論に「推計と proxy の明示」が明文化されている', () => {
    const skill = readFileSync(`${ROOT}/skills/market-analysis/SKILL.md`, 'utf-8')
    expect(skill).toContain('按分')
    expect(skill).toContain('コロナ影響')
    expect(skill).toContain('賃料ではない')
    expect(skill).toContain('昼間')
    expect(skill).toContain('店舗数そのものではない')
    expect(skill).toContain('出典')
  })

  it('災害の言い方の核（安全と言わない・限界を削らない）がスキルに明文化されている', () => {
    const hazard = readFileSync(`${ROOT}/skills/hazard-reading/SKILL.md`, 'utf-8')
    expect(hazard).toContain('絶対に書かない')
    expect(hazard).toContain('limitationsJa')
    expect(hazard).toContain('代表点 1 点')
  })
})

describe('フック', () => {
  it('hooks.json は CLAUDE_PLUGIN_ROOT のスクリプトを指し、スクリプトが実在する', () => {
    const hooks = readFileSync(`${ROOT}/hooks/hooks.json`, 'utf-8')
    expect(hooks).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/session-context.sh')
    const script = readFileSync(`${ROOT}/scripts/session-context.sh`, 'utf-8')
    expect(script.startsWith('#!/bin/sh')).toBe(true)
    expect(script).toContain('"hookEventName":"SessionStart"')
    // JSON として妥当（1 行・stdout がそのまま解釈されるため）。
    const jsonLine = script.split('\n').find((line) => line.startsWith("printf '%s' '"))
    expect(jsonLine).toBeDefined()
    if (jsonLine === undefined) return
    const payload = jsonLine.slice("printf '%s' '".length, -1)
    const parsed: unknown = JSON.parse(payload)
    expect(parsed).toHaveProperty('hookSpecificOutput')
  })
})
