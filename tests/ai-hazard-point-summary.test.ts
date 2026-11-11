import { describe, expect, it, vi } from 'vitest'
import { TOOL_SPECS, type ToolRunContext } from '@/ai/tool-specs'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { pointHazard } from '@/domain/hazard/point'
import type { HazardPointResponse } from '@/shared/api'

/**
 * 災害の応答に 3 項目（種類ごとの状態・畳まない注意・固有の事実）を足しても、
 * **AI（Gemini・MCP の本文）に渡す要約は変わらない**（`docs/261110_fix_PLAN.md` §8.4・§10.2 PR-4）。
 *
 * 要約（`hazardSummaryForLlm`）は項目を選んで作っているので、足した項目は入らない。
 * ここで固定しておかないと、要約を「応答をそのまま渡す」形に変えた日に、
 * プロンプトを 1 文字も触らずに Gemini への入力が変わる（関係の無い問の答えが揺れる）。
 */

const hazard = vi.hoisted(() => ({ hazardPointAt: vi.fn() }))
vi.mock('@/lib/hazard/point-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hazard/point-source')>()
  return { ...actual, ...hazard }
})

const CTX: ToolRunContext = { origin: 'http://localhost:3000' }

/** 亀有の形：洪水に該当・土砂の図なし・川の到達と継続あり（3 項目がどれも中身を持つ）。 */
const KAMEARI: HazardPointResponse = pointHazard(
  {
    lon: 139.847,
    lat: 35.7645,
    placeJa: '亀有駅',
    mesh: [],
    tile: [{ layerKey: 'flood_l2', hex: '#FFB7B7' }],
    tileNearby: [],
    uncoveredLayerKeys: ['dosekiryu', 'jisuberi'],
    unreachedLayerKeys: [],
    rivers: [{ nameJa: '中川', maxDepthM: 1.31, arriveMin: 30, continueMin: 5718 }],
    elevationM: 0.2,
    onlineSourcesReached: true,
    notesJa: [],
  },
  hazardLayersWithPointAnswer(),
)

/** 要約に入る項目（2026-11-11 の時点）。増やすなら、評価（chat-eval）を A/B で流してから。 */
const LLM_KEYS = [
  'placeJa',
  'meshCode',
  'level',
  'headlineJa',
  'evacuation',
  'certainty',
  'elevMeanM',
  'hazards',
  'rivers',
  'reasonsJa',
  'coverageNotesJa',
  'notesJa',
  'disclaimerJa',
]

async function summaryForLlm(point: HazardPointResponse): Promise<object> {
  hazard.hazardPointAt.mockResolvedValueOnce({ point, complete: true, uncoveredLayerKeys: [] })
  const result = await TOOL_SPECS.getHazardAtPoint.run(
    { lon: point.point.lon, lat: point.point.lat, placeJa: point.point.placeJa },
    CTX,
  )
  return result.forLlm
}

describe('getHazardAtPoint：AI に渡す要約は 3 項目を足しても変わらない', () => {
  it('前提：応答は 3 項目とも中身を持っている', () => {
    expect(KAMEARI.groupStates).toHaveLength(5)
    expect(KAMEARI.keyNotesJa).toHaveLength(1)
    expect(KAMEARI.highlightsJa).toHaveLength(2)
  })

  it('要約の項目は今のまま（種類ごとの状態・注意・事実は入らない）', async () => {
    expect(Object.keys(await summaryForLlm(KAMEARI))).toEqual(LLM_KEYS)
  })

  it('3 項目があっても無くても、要約は 1 文字も変わらない', async () => {
    const legacy: HazardPointResponse = {
      ...KAMEARI,
      groupStates: undefined,
      keyNotesJa: undefined,
      highlightsJa: undefined,
    }
    const now = JSON.stringify(await summaryForLlm(KAMEARI))
    expect(now).toBe(JSON.stringify(await summaryForLlm(legacy)))
  })
})
