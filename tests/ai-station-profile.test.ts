/**
 * AI のツール `getStationProfile`（MCP は `get_station_profile`）と、その回答の出し方（2026-10-09 B4）。
 *
 * 見ること：
 * - ツールは共通 API と同じ `loadStationProfile` を呼ぶ（DB を差し替え、本物の組み立てを通す）。LLM に返すのは
 *   **サーバが決めた文字列**（性格の目安・位置・注記・見ていないこと）で、順位や型を作らせる余地を残さない
 * - 6 段以外の半径は 1km に丸め、**丸めたと言う**。知らない駅は次の一手つきのエラー（副産物なし）
 * - パネルは駅カード＋プロフィール（compact・会話の中）、地図は駅へ寄って選ぶ（半径も合わせる）
 * - ⤢ の条件は「駅詳細を**概要タブ**で開く」。チャットは 1 つのグループに束ね、チップは「横浜 の概要」
 * - MCP にも同じツールが出る（数値の図ではないので `present` は広告しない）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  panelsForStationProfile,
  promotionsFor,
  assemble,
  mapActionsForEffect,
  summarizePanels,
} from '@/ai/assemble'
import {
  MCP_TOOL_CONFIGS,
  registerMcpTools,
  type McpToolRegistry,
  type McpToolResult,
} from '@/ai/mcp-tools'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { PROFILE_ANSWER_GUIDE_JA, TOOL_SPECS } from '@/ai/tool-specs'
import { type StationProfileEffect, type ToolEffect } from '@/ai/types'
import { mapResponseSchema } from '@/shared/protocol'
import { panelPromotionsSchema } from '@/shared/promotion'
import { buildPanelGroups } from '@/components/chat/panelGroups'
import { chipLabel } from '@/components/chat/PanelChip'
import { detailFocusOf, focusTabOf } from '@/components/chat/detailFocus'
import { HAZARD, rank, ranksFor, VALUES_1KM, VALUES_500M, YOKOHAMA } from './fixtures/profile'

const db = vi.hoisted(() => ({
  stationByGrp: vi.fn(),
  stationBundle: vi.fn(),
  stationProfileRanks: vi.fn(),
  stationHazardSummaries: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const CTX = { origin: 'http://localhost:3000' }

beforeEach(() => {
  vi.resetAllMocks()
  db.stationByGrp.mockResolvedValue(YOKOHAMA)
  db.stationBundle.mockResolvedValue(new Map(Object.entries({ ...VALUES_1KM, ...VALUES_500M })))
  db.stationProfileRanks.mockImplementation(async (_grp: string, keys: readonly string[]) =>
    ranksFor(keys, rank(66, 348, [37, 137])),
  )
  db.stationHazardSummaries.mockResolvedValue([
    { grp: '横浜#0', version: 1, computedAt: '2026-09-03T00:00:00Z', summary: HAZARD },
  ])
})

afterEach(() => {
  resetRateLimitStore()
})

/** ツールを 1 回走らせ、副産物と LLM 向けの要約を返す。 */
async function runTool(input: { grp: string; radiusM?: number }) {
  const spec = TOOL_SPECS.getStationProfile
  return spec.run(spec.inputSchema.parse(input), CTX)
}

/** 副産物からプロフィールの副産物だけを取り出す（型ガード）。 */
function profileEffectOf(effects: readonly ToolEffect[]): StationProfileEffect {
  const effect = effects.find(
    (each): each is StationProfileEffect => each.kind === 'stationProfile',
  )
  if (effect === undefined) throw new Error('プロフィールの副産物がありません')
  return effect
}

/** 入れ子の値を型なしで辿る（`as` を使わない）。 */
function pick(value: unknown, ...path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null) return undefined
    return Reflect.get(current, key)
  }, value)
}

describe('getStationProfile（ツール）', () => {
  it('共通 API と同じ組み立てを通し、副産物はプロフィールそのもの', async () => {
    const { effects } = await runTool({ grp: '横浜#0' })
    const { profile } = profileEffectOf(effects)
    expect(profile.station.grp).toBe('横浜#0')
    expect(profile.radiusM).toBe(1000)
    expect(db.stationProfileRanks.mock.calls[0]?.[2]).toBe('横浜市')
  })

  it('LLM には、サーバが決めた性格・位置・注記・見ていないことを文字列のまま渡す', async () => {
    const { forLlm } = await runTool({ grp: '横浜#0' })
    expect(pick(forLlm, 'character')).toEqual({
      type: '業務地型',
      meaning: '働きに来る人が、住む人より多いエリア',
      basis: '1km圏の従業者 179,031 人（2021年）は、人口 43,471 人（2020年）の 4.1 倍',
    })
    expect(pick(forLlm, 'radius')).toBe('1km圏')
    expect(pick(forLlm, 'sections', 0, 'items', 0)).toEqual({
      name: '人口',
      when: '2020年',
      value: '43,471 人',
      positions: ['神奈川県内 348 駅中 66 位（上位 19%）', '横浜市内 137 駅中 37 位（上位 28%）'],
    })
    expect(pick(forLlm, 'notCovered')).toEqual(expect.arrayContaining(['治安（犯罪の件数）']))
    // 答え方は結果と一緒に渡す（型名を言い換えない・箇条書きにしない・ツールに無い事実を書かない）
    expect(pick(forLlm, 'answerGuide')).toBe(PROFILE_ANSWER_GUIDE_JA)
    expect(PROFILE_ANSWER_GUIDE_JA).toContain('character.type の語のまま')
    expect(PROFILE_ANSWER_GUIDE_JA).toContain('箇条書きにせず')
    expect(PROFILE_ANSWER_GUIDE_JA).toContain(
      'このデータに無い事実（商業施設・名所・再開発・治安・学校・街の雰囲気など）は、知っていても書かない',
    )
    expect(PROFILE_ANSWER_GUIDE_JA).toContain('「安全」と言わない')
    expect(PROFILE_ANSWER_GUIDE_JA).toContain(
      'データに無い評価（「人気」「注目されている」「住みやすい」「便利」など）も足さない',
    )
    expect(pick(forLlm, 'hazard', 'headline')).toBe(HAZARD.headlineJa)
    expect(pick(forLlm, 'hazard', 'caveat')).toEqual(expect.stringContaining('駅の代表点 1 点'))
    expect(JSON.stringify(forLlm)).not.toContain('安全です')
  })

  it('6 段以外の半径は 1km に丸め、丸めたと言う', async () => {
    const { forLlm, effects } = await runTool({ grp: '横浜#0', radiusM: 3000 })
    expect(profileEffectOf(effects).profile.radiusM).toBe(1000)
    expect(pick(forLlm, 'note')).toBe('半径 3000m は無いため、1km圏で集計しました。')
    const plain = await runTool({ grp: '横浜#0', radiusM: 500 })
    expect(pick(plain.forLlm, 'note')).toBeUndefined()
    expect(pick(plain.forLlm, 'radius')).toBe('500m圏')
  })

  it('知らない駅は次の一手つきのエラー（副産物なし・値も順位も引かない）', async () => {
    db.stationByGrp.mockResolvedValue(null)
    const { forLlm, effects } = await runTool({ grp: 'どこにもない#0' })
    expect(effects).toEqual([])
    expect(forLlm).toEqual({
      error: '駅が見つかりません: どこにもない#0',
      hint: 'searchStations で grp を取り直してください。',
    })
    expect(db.stationProfileRanks).not.toHaveBeenCalled()
  })
})

describe('回答の出し方（パネル・地図・⤢）', () => {
  async function effect(): Promise<StationProfileEffect> {
    return profileEffectOf((await runTool({ grp: '横浜#0', radiusM: 2000 })).effects)
  }

  it('パネルは駅カード → プロフィール（どちらも compact・会話の中）', async () => {
    const panels = panelsForStationProfile(await effect())
    expect(panels.map((panel) => panel.type)).toEqual(['stationCard', 'stationProfile'])
    for (const panel of panels) {
      expect(panel.size).toBe('compact')
      expect(panel.placement).toBe('inline')
    }
  })

  it('地図は駅へ寄って選ぶ（半径も合わせる＝概要タブがその半径で開く）', async () => {
    expect(mapActionsForEffect(await effect())).toEqual([
      { type: 'flyTo', lon: YOKOHAMA.lon, lat: YOKOHAMA.lat, zoom: 12 },
      { type: 'selectStation', grp: '横浜#0', radiusM: 2000 },
    ])
  })

  it('⤢ の条件は「駅詳細を概要タブで開く」（先頭の駅カードにだけ）', async () => {
    const promotions = promotionsFor([await effect()])
    expect(promotions).toEqual([
      { kind: 'detail', grp: '横浜#0', category: null, tab: 'overview' },
      null,
    ])
    expect(() => panelPromotionsSchema.parse(promotions)).not.toThrow()
  })

  it('MapResponse は protocol の Zod を通り、LLM 向けの要約にも性格と位置が出る', async () => {
    const response = assemble([await effect()], '横浜駅の周辺は業務地型です。')
    expect(() => mapResponseSchema.parse(response)).not.toThrow()
    const summary = summarizePanels(response.panels)
    expect(summary).toContain('業務地型')
    expect(summary).toContain('神奈川県内上位 19%')
  })

  it('チャットは 1 つのグループに束ね、チップは「横浜 の概要」、ドロワーは概要タブで開く', async () => {
    const one = await effect()
    const panels = panelsForStationProfile(one)
    const promotions = promotionsFor([one])
    const groups = buildPanelGroups(panels, promotions)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.panels.map((panel) => panel.type)).toEqual(['stationCard', 'stationProfile'])
    expect(chipLabel(groups[0]?.panels ?? [], groups[0]?.promotion ?? null)).toBe('横浜 の概要')
    expect(detailFocusOf(promotions)).toEqual({ grp: '横浜#0', tab: 'overview' })
  })

  it('タブの指定はカテゴリより先（カテゴリだけなら従来どおり写す・どちらも無ければ触らない）', () => {
    const base = { kind: 'detail' as const, grp: '東京#0' }
    expect(focusTabOf({ ...base, category: 'population', tab: 'overview' })).toBe('overview')
    expect(focusTabOf({ ...base, category: 'population_forecast' })).toBe('population')
    expect(focusTabOf({ ...base, category: null })).toBeNull()
  })
})

describe('MCP（get_station_profile）', () => {
  type Registered = {
    name: string
    inputSchema: z.ZodTypeAny
    callback: (input: unknown) => Promise<McpToolResult>
  }

  function registered(): Registered {
    const tools: Registered[] = []
    const server: McpToolRegistry = {
      registerTool: (name, config, callback) => {
        tools.push({ name, inputSchema: config.inputSchema, callback })
      },
      registerResource: () => undefined,
    }
    registerMcpTools(server, CTX.origin)
    const tool = tools.find((each) => each.name === 'get_station_profile')
    if (tool === undefined) throw new Error('get_station_profile がありません')
    return tool
  }

  it('同じ Spec をそのまま登録する（数値の図ではないので present は広告しない）', () => {
    const tool = registered()
    expect(MCP_TOOL_CONFIGS.getStationProfile.chartable).not.toBe(true)
    expect(tool.inputSchema).toBe(TOOL_SPECS.getStationProfile.inputSchema)
  })

  it('structuredContent に要約とパネル（駅カード＋プロフィール）・地図操作が載る', async () => {
    const result = await registered().callback({ grp: '横浜#0' })
    expect(result.isError).not.toBe(true)
    const structured = result.structuredContent
    expect(pick(structured, 'result', 'character', 'type')).toBe('業務地型')
    const panels = pick(structured, 'panels')
    expect(Array.isArray(panels) ? panels.map((panel) => pick(panel, 'type')) : []).toEqual([
      'stationCard',
      'stationProfile',
    ])
    expect(pick(structured, 'mapActions', 1, 'type')).toBe('selectStation')
  })
})
