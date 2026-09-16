/**
 * 空振りの言い方（`src/components/recommend/advice.ts`）を固定する。
 *
 * 「該当なし」とだけ返すのは、**こちらが理由を知っているのに黙っている**ということ。
 * 候補が 0 だったのか／候補はあったが全部外れたのか／外れた理由は災害か欠損か ⚠ か——
 * どれも応答に入っているので、**何が起きたか**と**次にどのつまみを動かすか**まで言う。
 *
 * ここが崩れると、画面は「エラーではないが先へ進めない」状態になる。
 * 見た目には壊れていないので、検査で止めるほかない。
 */

import { describe, expect, it } from 'vitest'
import { resultAdvice, THIN_RESULT_MAX, type AdviceInput } from '@/components/recommend/advice'

const NO_EXCLUSIONS = { missing: 0, flagged: 0, hazard: 0, total: 0 }

function input(overrides: Partial<AdviceInput> = {}): AdviceInput {
  return {
    candidateCount: 20,
    rankedCount: 18,
    area: {
      labelJa: '神奈川県・横浜市',
      municipality: '横浜市',
      routes: [],
      operators: [],
      routeTypes: [],
    },
    excludedCounts: NO_EXCLUSIONS,
    hazard: { mode: 'exclude', groupJa: '洪水', atOrAbove: 'danger' },
    ...overrides,
  }
}

describe('ふつうに順位が出たときは何も言わない', () => {
  it('十分な件数なら助言は要らない', () => {
    expect(resultAdvice(input())).toBeNull()
  })
})

describe('候補が 0 件', () => {
  it('どのエリアで空振りしたかを言う', () => {
    const advice = resultAdvice(input({ candidateCount: 0, rankedCount: 0 }))
    expect(advice?.tone).toBe('empty')
    expect(advice?.headlineJa).toContain('神奈川県・横浜市')
  })

  it('路線で絞っているなら、まずそれを外すよう言う', () => {
    const advice = resultAdvice(
      input({
        candidateCount: 0,
        rankedCount: 0,
        area: {
          labelJa: '神奈川県（東海道線）',
          municipality: null,
          routes: ['東海道線'],
          operators: [],
          routeTypes: [],
        },
      }),
    )
    expect(advice?.hintsJa.some((hint) => hint.includes('路線'))).toBe(true)
  })

  it('市区町村で絞っているなら、全域に戻すよう言う', () => {
    const advice = resultAdvice(input({ candidateCount: 0, rankedCount: 0 }))
    expect(advice?.hintsJa.some((hint) => hint.includes('全域'))).toBe(true)
  })

  it('何も絞っていないなら、別のエリアを選ぶよう言う', () => {
    const advice = resultAdvice(
      input({
        candidateCount: 0,
        rankedCount: 0,
        area: {
          labelJa: '沖縄県',
          municipality: null,
          routes: [],
          operators: [],
          routeTypes: [],
        },
      }),
    )
    expect(advice?.hintsJa.some((hint) => hint.includes('別のエリア'))).toBe(true)
  })
})

describe('候補はあったが、全部外れた', () => {
  it('災害の足切りなら、1 段緩める先を名指しする', () => {
    const advice = resultAdvice(
      input({ rankedCount: 0, excludedCounts: { ...NO_EXCLUSIONS, hazard: 20, total: 20 } }),
    )
    expect(advice?.headlineJa).toContain('20 駅')
    expect(advice?.hintsJa.some((hint) => hint.includes('「危険」から「極めて危険」'))).toBe(true)
    expect(advice?.hintsJa.some((hint) => hint.includes('段階減点'))).toBe(true)
  })

  it('これ以上緩められないときは、緩めろとは言わない', () => {
    const advice = resultAdvice(
      input({
        rankedCount: 0,
        excludedCounts: { ...NO_EXCLUSIONS, hazard: 20, total: 20 },
        hazard: { mode: 'exclude', groupJa: '洪水', atOrAbove: 'critical' },
      }),
    )
    expect(advice?.hintsJa.some((hint) => hint.includes('緩める'))).toBe(false)
    expect(advice?.hintsJa.some((hint) => hint.includes('段階減点'))).toBe(true)
  })

  it('欠損なら、半径と重みの話をする', () => {
    const advice = resultAdvice(
      input({ rankedCount: 0, excludedCounts: { ...NO_EXCLUSIONS, missing: 20, total: 20 } }),
    )
    expect(advice?.hintsJa.some((hint) => hint.includes('半径'))).toBe(true)
    expect(advice?.hintsJa.some((hint) => hint.includes('重みを 0'))).toBe(true)
  })

  it('⚠ 除外なら、そのチェックを外すよう言う', () => {
    const advice = resultAdvice(
      input({ rankedCount: 0, excludedCounts: { ...NO_EXCLUSIONS, flagged: 20, total: 20 } }),
    )
    expect(advice?.hintsJa.some((hint) => hint.includes('⚠除外'))).toBe(true)
  })

  it('理由が混ざっていたら、混ざったまま全部言う', () => {
    const advice = resultAdvice(
      input({
        rankedCount: 0,
        excludedCounts: { missing: 3, flagged: 2, hazard: 15, total: 20 },
      }),
    )
    expect(advice?.hintsJa.some((hint) => hint.includes('段階減点'))).toBe(true)
    expect(advice?.hintsJa.some((hint) => hint.includes('半径'))).toBe(true)
    expect(advice?.hintsJa.some((hint) => hint.includes('⚠除外'))).toBe(true)
  })
})

describe('少なすぎる結果を「順位」と呼ばない', () => {
  it('1 駅の「1 位」は順位ではないと言う', () => {
    const advice = resultAdvice(input({ candidateCount: 4, rankedCount: 1 }))
    expect(advice?.tone).toBe('thin')
    expect(advice?.headlineJa).toContain('1 駅')
    expect(advice?.hintsJa.some((hint) => hint.includes('相対評価'))).toBe(true)
  })

  it('境界：正規化が意味を持つ数（2 駅）までは注意し、超えたら黙る', () => {
    expect(resultAdvice(input({ rankedCount: THIN_RESULT_MAX }))?.tone).toBe('thin')
    expect(resultAdvice(input({ rankedCount: THIN_RESULT_MAX + 1 }))).toBeNull()
  })
})
