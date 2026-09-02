import { describe, expect, it } from 'vitest'
import {
  TOOL_SPECS,
  TOOL_SPEC_NAMES,
  type ToolRunContext,
  type ToolRunResult,
} from '@/ai/tool-specs'
import { createTools, executeFromSpec } from '@/ai/tools'
import { createCollector, type ToolEffect } from '@/ai/types'

/**
 * **ToolSpec の分離**（`docs/260828_research_claude_auth.md` §10 PR-1）。
 *
 * 目的は「Gemini（AI SDK）と MCP が同じ定義を消費する」ための分離であって、
 * **挙動を 1 ミリも変えない**こと。ここで固定するのは、
 * ① Gemini が見るツール表面（説明・スキーマ）が Spec と**同一の参照**であること、
 * ② アダプタ（`executeFromSpec`）の副産物・エラーの扱いが分離前の execute と同じであること。
 */

describe('TOOL_SPECS（登録の網羅）', () => {
  it('12 ツールが揃っている（増減したら MCP 側の写しも見直す）', () => {
    expect(TOOL_SPEC_NAMES).toEqual([
      'searchStations',
      'listStations',
      'buildDataset',
      'getHazardSummary',
      'getStationDetail',
      'rankStations',
      'compareGrowth',
      'getHazardAtPoint',
      'getHazardAlerts',
      'findEvacuationSites',
      'findEscapeDirection',
      'getMetricsCatalog',
    ])
    // 名簿とレジストリのキーが一致（片方だけ増える事故を防ぐ）。
    expect(Object.keys(TOOL_SPECS)).toEqual([...TOOL_SPEC_NAMES])
  })

  it('name はキーと一致し、説明は空でない', () => {
    for (const key of TOOL_SPEC_NAMES) {
      const spec = TOOL_SPECS[key]
      expect(spec.name).toBe(key)
      expect(spec.description.length).toBeGreaterThan(10)
    }
  })

  it('捕捉しないのは純粋な照会（getMetricsCatalog）だけ', () => {
    for (const key of TOOL_SPEC_NAMES) {
      const spec = TOOL_SPECS[key]
      if (key === 'getMetricsCatalog') expect(spec.errorFallbackJa).toBeNull()
      else expect(typeof spec.errorFallbackJa).toBe('string')
    }
  })
})

describe('Gemini のツール表面 ＝ Spec（同一の参照・ずれない）', () => {
  const tools = createTools(createCollector(), 'http://localhost:3000')

  it('全ツールの説明とスキーマが Spec と同じ物体（Layer 2 の 2 本は §5.6 で除外）', () => {
    for (const key of TOOL_SPEC_NAMES) {
      if (key === 'buildDataset' || key === 'getHazardSummary') continue
      const spec = TOOL_SPECS[key]
      const built = tools[key]
      expect(built.description, key).toBe(spec.description)
      expect(built.inputSchema, key).toBe(spec.inputSchema)
    }
  })

  it('buildDataset / getHazardSummary は Gemini に出さない（Layer 2・§5.6）', () => {
    expect('buildDataset' in tools).toBe(false)
    expect('getHazardSummary' in tools).toBe(false)
    expect(Object.keys(tools)).toHaveLength(TOOL_SPEC_NAMES.length - 2)
  })
})

describe('executeFromSpec（アダプタの不変条件）', () => {
  // 形だけの副産物。collector もアダプタも中身を見ない（運ぶだけ）ので、
  // 巨大な応答型をここで組み立てない。JSON 経由（any→ToolEffect）でキャストを避ける。
  function fakeEffect(kind: ToolEffect['kind']): ToolEffect {
    return JSON.parse(JSON.stringify({ kind, response: {} }))
  }
  const EFFECT_A = fakeEffect('ranking')
  const EFFECT_B = fakeEffect('growth')

  type StubInput = { value: string }

  function stub<Out>(
    behavior: (input: StubInput, ctx: ToolRunContext) => Promise<ToolRunResult<Out>>,
    errorFallbackJa: string | null = '失敗しました',
  ): { errorFallbackJa: string | null; run: typeof behavior } {
    return { errorFallbackJa, run: behavior }
  }

  async function call<Out>(spec: {
    errorFallbackJa: string | null
    run: (input: StubInput, ctx: ToolRunContext) => Promise<ToolRunResult<Out>>
  }): Promise<{ result: Out | { error: string }; drained: readonly ToolEffect[] }> {
    const collector = createCollector()
    const execute = executeFromSpec(spec, collector, 'http://origin')
    const result = await execute({ value: 'x' })
    return { result, drained: collector.drain() }
  }

  it('成功：副産物を順序どおり収集し、forLlm を返す', async () => {
    const { result, drained } = await call(
      stub(async () => ({ effects: [EFFECT_A, EFFECT_B], forLlm: { ok: true } })),
    )
    expect(result).toEqual({ ok: true })
    expect(drained).toEqual([EFFECT_A, EFFECT_B])
  })

  it('構造化エラー（forLlm に error）：例外ではないので素通し・副産物なし', async () => {
    const { result, drained } = await call(
      stub(async () => ({ effects: [], forLlm: { error: 'だめ', hint: 'こうして' } })),
    )
    expect(result).toEqual({ error: 'だめ', hint: 'こうして' })
    expect(drained).toEqual([])
  })

  it('Error を投げたら message を返す（分離前の catch と同じ）', async () => {
    const { result, drained } = await call(
      stub<never>(async () => {
        throw new Error('接続できません')
      }),
    )
    expect(result).toEqual({ error: '接続できません' })
    expect(drained).toEqual([])
  })

  it('Error 以外を投げたら errorFallbackJa を返す', async () => {
    const { result } = await call(
      stub<never>(async () => {
        throw 'boom'
      }, 'ランキングに失敗しました'),
    )
    expect(result).toEqual({ error: 'ランキングに失敗しました' })
  })

  it('errorFallbackJa が null なら捕捉しない（純粋な照会は投げたら上へ）', async () => {
    await expect(
      call(
        stub<never>(async () => {
          throw new Error('カタログ破損')
        }, null),
      ),
    ).rejects.toThrow('カタログ破損')
  })

  it('run へ origin が渡る（共通API の絶対 URL を組むための文脈）', async () => {
    const seen: string[] = []
    await call(
      stub(async (_input, ctx) => {
        seen.push(ctx.origin)
        return { effects: [], forLlm: { ok: true } }
      }),
    )
    expect(seen).toEqual(['http://origin'])
  })
})

describe('純粋な Spec は直接実行できる（MCP からの消費の予行）', () => {
  it('getMetricsCatalog.run は副産物なしでダイジェストを返す', async () => {
    const { effects, forLlm } = await TOOL_SPECS.getMetricsCatalog.run(
      { category: undefined, baseMetric: undefined },
      { origin: '' },
    )
    expect(effects).toEqual([])
    expect(forLlm).toBeTruthy()
    expect(typeof forLlm).toBe('object')
  })
})
