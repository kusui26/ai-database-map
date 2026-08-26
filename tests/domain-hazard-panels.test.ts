import { describe, expect, it } from 'vitest'
import { hazardCardPanel } from '@/domain/hazard/panels'
import { pointHazard } from '@/domain/hazard/point'
import { durationPhraseJa, riverReasonsJa } from '@/domain/hazard/wording'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { panelSchema } from '@/shared/protocol'
import { surroundingPrimaries } from '@/shared/mesh'

/**
 * 現在地の表示（Phase 2 / PR-2b）。UI に出るのは `hazardCard` パネル 1 枚で、
 * それは**チャットが返すのと同じもの**。ここで固定するのは
 * 「パネルにしたときに意味が落ちないこと」と「先読みの範囲」である。
 */

const ALL_LAYERS = hazardLayersWithPointAnswer()

const BASE = {
  lon: 139.847,
  lat: 35.7645,
  placeJa: '現在地',
  mesh: [],
  tile: [],
  rivers: [],
  elevationM: 0.2,
  online: true,
  notesJa: [],
} as const

describe('hazard/panels: 地点の応答 → hazardCard', () => {
  it('プロトコルの Panel としてそのまま通る', () => {
    const point = pointHazard(
      { ...BASE, tile: [{ layerKey: 'flood_l2', hex: '#FFB7B7' }] },
      ALL_LAYERS,
    )
    const panel = hazardCardPanel(point, 'compact')
    expect(() => panelSchema.parse(panel)).not.toThrow()
    expect(panel.placeJa).toBe('現在地')
    expect(panel.certainty).toBe('exact')
    expect(panel.items[0]?.source).toBe('tile')
  })

  it('取れなかったものの説明を、網羅性の注記と同じ場所に出す', () => {
    const notesJa = ['河川別の浸水深・到達時間は取得できませんでした']
    const panel = hazardCardPanel(pointHazard({ ...BASE, notesJa }, ALL_LAYERS))
    expect(panel.coverageNotesJa[0]).toBe(notesJa[0])
  })

  it('新しい判断を足さない（危険度・行動・見出しは応答のまま）', () => {
    const point = pointHazard(
      {
        ...BASE,
        mesh: [{ layerKey: 'flood_l2', sourceCode: 3, coverage: 1, neighbourSourceCode: 3 }],
      },
      ALL_LAYERS,
    )
    const panel = hazardCardPanel(point)
    expect(panel.level).toBe(point.verdict.level)
    expect(panel.evacuation).toBe(point.verdict.evacuation)
    expect(panel.headlineJa).toBe(point.verdict.headlineJa)
    expect(panel.reasonsJa).toEqual(point.verdict.reasonsJa)
  })
})

describe('hazard/wording: 河川の「何分後に・何日続く」', () => {
  it('いちばん早いものといちばん長いものだけを言う', () => {
    const rivers = [
      { nameJa: '荒川', arriveMin: 162, continueMin: 5283 },
      { nameJa: '中川', arriveMin: 30, continueMin: 5718 },
      { nameJa: '利根川', arriveMin: 1434, continueMin: 14508 },
    ]
    const reasons = riverReasonsJa(rivers)
    expect(reasons).toHaveLength(2)
    expect(reasons[0]).toBe('中川の氾濫では約 30 分で浸水が始まる想定です')
    expect(reasons[1]).toBe('利根川の氾濫では最大約 10 日間浸水が続く想定です')
  })

  it('値が無ければその文は出さない', () => {
    expect(riverReasonsJa([{ nameJa: '綾瀬川', arriveMin: null, continueMin: null }])).toEqual([])
    expect(riverReasonsJa([])).toEqual([])
  })

  it('長さは分・時間・日で言い分ける', () => {
    expect(durationPhraseJa(30)).toBe('約 30 分')
    expect(durationPhraseJa(162)).toBe('約 3 時間')
    expect(durationPhraseJa(14508)).toBe('約 10 日間')
  })

  it('河川の情報は判定を動かさない（§6.2 の表は閾値の合意記録）', () => {
    const rivers = [{ nameJa: '中川', maxDepthM: null, arriveMin: 30, continueMin: 5718 }]
    const point = pointHazard({ ...BASE, rivers }, ALL_LAYERS)
    expect(point.verdict.evacuation).toBe('stay') // 該当ゼロのまま
    expect(point.verdict.reasonsJa.some((reason) => reason.includes('中川'))).toBe(true)
  })
})

describe('mesh: オフライン用に先読みする範囲', () => {
  it('その 1 次メッシュと周囲 8 枚（3×3）', () => {
    const primaries = surroundingPrimaries(139.847, 35.7645)
    expect(primaries).toHaveLength(9)
    expect(primaries).toContain('5339') // 東京
    expect(primaries).toContain('5340') // 東
    expect(primaries).toContain('5439') // 北
    expect(primaries).toContain('5238') // 南西
    expect(new Set(primaries).size).toBe(9)
  })
})
