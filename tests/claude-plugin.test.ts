import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MCP_TOOL_CONFIGS } from '@/ai/mcp-tools'
import { TOOL_SPEC_NAMES } from '@/ai/tool-specs'

/**
 * **Claude Code プラグイン**（`docs/260828_research_claude_auth.md` §4.5 PR-3）。
 *
 * 固定するのは、①マニフェスト類が壊れていないこと、②スキル・エージェントが参照する
 * **ツール名が実在すること**（完全修飾名も、本文の短い名前も——打ち間違いは実行時に
 * 「tool not found」で静かに壊れる）、③知識型スキルが claude.ai/Cowork でハードエラーに
 * なる Claude Code 専用フィールドを使っていないこと、④**母艦（Canvas）対応の作法**が
 * 明文化されていること（PR-14・`docs/260912_gui_chat_protocol.md` §4.5）。
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

/** 実在する MCP ツール名（短い綴り）。 */
const validNames = new Set(TOOL_SPEC_NAMES.map((key) => MCP_TOOL_CONFIGS[key].mcpName))
/** プラグイン導入時の完全修飾接頭辞。 */
const prefix = `mcp__plugin_${PLUGIN_NAME}_${SERVER_KEY}__`

function pluginTextFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|json|sh)$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`)
}

describe('完全修飾ツール名（打ち間違いは静かに壊れる）', () => {
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

  it('本文の短い名前も実在する（接頭辞は環境で変わるので短い名前で書く）', () => {
    // 当アプリのツールらしい綴り（`get_` などの動詞接頭辞＋snake_case）だけを拾う。
    const looksLikeTool = /^(?:search|list|build|render|rank|compare|find|get)_[a-z0-9_]+$/
    const mentioned = new Set<string>()
    for (const path of pluginTextFiles(`${ROOT}/skills`)) {
      const source = readFileSync(path, 'utf-8')
      for (const match of source.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
        const token = match[1] ?? ''
        if (!looksLikeTool.test(token)) continue
        expect(validNames.has(token), `${path}: ${token}`).toBe(true)
        mentioned.add(token)
      }
    }
    // 骨格が主要ツールを短い名前で案内している。
    for (const key of ['list_stations', 'build_dataset', 'render_map', 'get_metrics_catalog']) {
      expect(mentioned.has(key), key).toBe(true)
    }
  })

  it('サブエージェントの tools は全ツール × 2 綴り（プラグイン導入と mcp add の両方で効く）', () => {
    const front = frontmatterOf(`${ROOT}/agents/data-analyst.md`)
    const tools = (front['tools'] ?? '').split(',').map((name) => name.trim())
    for (const name of validNames) {
      expect(tools).toContain(`${prefix}${name}`)
      expect(tools).toContain(`mcp__${SERVER_KEY}__${name}`)
    }
    expect(tools.filter((name) => name.startsWith('mcp__')).length).toBe(TOOL_SPEC_NAMES.length * 2)
    // CSV をローカルで分析すると本文が言う以上、その道具が要る（tools: を書くと
    // ここに無いものは使えない）。図は親のセッションに返す＝プレゼンタは列挙しない。
    for (const name of ['Bash', 'Read', 'Write']) {
      expect(tools).toContain(name)
    }
    const body = readFileSync(`${ROOT}/agents/data-analyst.md`, 'utf-8')
    expect(body).toContain('図はこのサブエージェントでは出さない')
    // 親はこの報告をそのまま使う。限界・出典・正規化の脚注が無いと、親の答えから消える。
    expect(body).toContain('限界と出典・正規化の脚注は要約しない')
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

  it('引ける範囲が決まるコマンドだけ allowed-tools を持ち、2 綴りを並べる', () => {
    for (const skill of ['station', 'rank']) {
      const allowed = frontmatterOf(`${ROOT}/skills/${skill}/SKILL.md`)['allowed-tools'] ?? ''
      const names = allowed.split(',').map((name) => name.trim())
      expect(names.length, skill).toBeGreaterThan(1)
      // 同じツールが 2 通りの綴りで並ぶ（プラグイン導入と `claude mcp add` の両方）。
      const shorts = names.map((name) => name.replace(/^mcp__.*?__/, ''))
      expect(new Set(shorts).size * 2, skill).toBe(names.length)
      for (const short of new Set(shorts)) expect(validNames.has(short), short).toBe(true)
    }
  })

  it('分析コマンドは allowed-tools を持たない（Bash と母艦のプレゼンタが要る）', () => {
    // 母艦のツール名（mcp__mt__presentChart など）は環境依存で事前に列挙できず、
    // ローカル解析（Bash）も要る。列挙すると**動かないコマンド**になるので持たせない。
    for (const skill of ['recommend', 'demand', 'market']) {
      expect(
        frontmatterOf(`${ROOT}/skills/${skill}/SKILL.md`)['allowed-tools'],
        skill,
      ).toBeUndefined()
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

describe('母艦（Canvas）対応・PR-14', () => {
  it('骨格に Canvas の作法がある（図は出すが、意味を落とさない）', () => {
    const skill = readFileSync(`${ROOT}/skills/station-analysis/SKILL.md`, 'utf-8')
    expect(skill).toContain('presentChart')
    expect(skill).toContain('presentForm')
    expect(skill).toContain('present: "echarts"')
    expect(skill).toContain('render_map')
    // サーバの option は書き直さない／自作の図には脚注を付ける／図だけで終わらせない。
    expect(skill).toContain('転記せずそのまま渡す')
    expect(skill).toContain('自分で計算した値')
    expect(skill).toContain('書き直す')
    expect(skill).toContain('限界・出典')
    expect(skill).toContain('ハザードをチャートにする')
    // 接頭辞は環境で変わる、を明示している。
    expect(skill).toContain('末尾が一致するもの')
  })

  it('Canvas の詳細（参照）に、検出・手順・禁じ手・保存場所が揃っている', () => {
    const ref = readFileSync(`${ROOT}/skills/station-analysis/references/canvas.md`, 'utf-8')
    expect(ref).toContain('末尾の名前で見分ける')
    expect(ref).toContain('presentDocument')
    expect(ref).toContain('fetch_map.py')
    expect(ref).toContain('禁じ手')
    // サーバ由来と自作の線引き（自作の図・自分で組む highlightStations を塞がない）。
    expect(ref).toContain('自分で計算した値')
    expect(ref).toContain('highlightStations')
    expect(ref).toContain('artifacts/')
    expect(ref).toContain('./data/')
  })

  // 母艦の実スキーマ（@mulmoclaude/*-plugin の TOOL_DEFINITION）に合わせる。
  // presentDocument は title が必須で、filenamePrefix が無いと保存名が document に落ちる。
  it('プレゼンタの引数の形が書いてある（母艦で弾かれる呼び方をしない）', () => {
    const ref = readFileSync(`${ROOT}/skills/station-analysis/references/canvas.md`, 'utf-8')
    expect(ref).toContain('filenamePrefix')
    expect(ref).toContain('charts: [{ title?, type?, option }]')
    expect(ref).toContain('fields: [{ id, type, label, choices?, required? }]')
    const skill = readFileSync(`${ROOT}/skills/station-analysis/SKILL.md`, 'utf-8')
    expect(skill).toContain('filenamePrefix')
  })

  it('用途レシピにも Canvas の 1 行がある（骨格が読まれなくても崩れない）', () => {
    for (const skill of ['station-recommendation', 'transport-planning', 'market-analysis']) {
      const source = readFileSync(`${ROOT}/skills/${skill}/SKILL.md`, 'utf-8')
      expect(source, skill).toContain('presentChart')
      expect(source, skill).toContain('render_map')
    }
  })

  // 実走で見つけた退行：薄いコマンドカードが「ツールを呼ばない」と書くと、
  // `presentForm` まで禁じてしまう（ターン1 はカードしか読まれない）。
  it('コマンドの「先に聞く」は、フォームを塞がない（禁じるのはデータツールだけ）', () => {
    for (const command of ['recommend', 'demand', 'market']) {
      const source = readFileSync(`${ROOT}/skills/${command}/SKILL.md`, 'utf-8')
      expect(source, command).toContain('データツールは呼ばない')
      expect(source, command).not.toContain('ではツールを呼ばない')
      expect(source, command).toContain('presentForm')
    }
  })

  it('災害はチャートにしない（順序尺度・免責と時制が落ちる）', () => {
    const hazard = readFileSync(`${ROOT}/skills/hazard-reading/SKILL.md`, 'utf-8')
    expect(hazard).toContain('チャートにしない')
    expect(hazard).toContain('順序尺度')
    expect(hazard).toContain('render_map')
  })

  // ターン1 でスキルがロードされないことがある（実走で観測）。そのとき唯一残る文脈が
  // これなので、「先に要件を聞く」「フォームで聞く」まではここに書く。
  it('SessionStart の 1 文が、名前の見分け方と Canvas の入口を伝える', () => {
    const script = readFileSync(`${ROOT}/scripts/session-context.sh`, 'utf-8')
    expect(script).toContain('末尾の名前')
    expect(script).toContain('presentChart')
    expect(script).toContain('render_map')
    expect(script).toContain('要件を 1 回聞く')
    expect(script).toContain('presentForm 1 枚')
    // 実走の退行：スキルが 1 つもロードされない回がある。そこで落ちたものだけを足した
    // ——出典（親が要約して落とした）・正規化（図の副題にだけ書いた）・対象集合のまとめ呼び。
    expect(script).toContain('限界と出典を必ず置く')
    expect(script).toContain('正規化してから重み付け')
    expect(script).toContain('list_stations を 1 回')
    // JSON 1 行として壊れていないこと（単一引用符の中なので ' は書けない）。
    const context = JSON.parse(
      execFileSync('sh', [`${ROOT}/scripts/session-context.sh`], { encoding: 'utf-8' }),
    )
    expect(context.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(context.hookSpecificOutput.additionalContext.length).toBeLessThan(700)
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
