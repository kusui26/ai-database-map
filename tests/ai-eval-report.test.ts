/**
 * eval の集計（`src/ai/eval/report.ts`・純関数）。
 *
 * モデルを比べるとき、合格数だけでは足りない——所要時間（思考型は遅くなりうる）と、
 * 再試行に頼った問の数（合格数はこれで隠れる）を並べる。その数え方を固定する。
 */

import { describe, expect, it } from 'vitest'
import { type EvalRun, percentile, renderReport, summarizeRuns } from '@/ai/eval/report'

function run(overrides: Partial<EvalRun> & Pick<EvalRun, 'id'>): EvalRun {
  return {
    category: '駅詳細',
    pass: true,
    failedChecks: [],
    elapsedMs: 1000,
    retried: false,
    toolCallCount: 1,
    ...overrides,
  }
}

describe('分位（最近順位法）', () => {
  it('空なら 0', () => {
    expect(percentile([], 95)).toBe(0)
  })

  it('1 件ならその値', () => {
    expect(percentile([7], 50)).toBe(7)
    expect(percentile([7], 95)).toBe(7)
  })

  it('並び順に依らない', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
  })

  it('38 件の p95 は大きい方から 2 番目（ランク 37）', () => {
    const values = Array.from({ length: 38 }, (_, index) => index + 1)
    expect(percentile(values, 95)).toBe(37)
    expect(percentile(values, 50)).toBe(19)
  })

  it('p100 は最大、p0 は最小', () => {
    expect(percentile([3, 9, 1], 100)).toBe(9)
    expect(percentile([3, 9, 1], 0)).toBe(1)
  })
})

describe('集計', () => {
  const runs: EvalRun[] = [
    run({ id: 'a', elapsedMs: 1200 }),
    run({
      id: 'b',
      category: '災害',
      pass: false,
      failedChecks: ['「安全」を含まない'],
      elapsedMs: 9000,
    }),
    run({ id: 'c', category: '災害', elapsedMs: 3000, retried: true }),
    run({ id: 'd', category: '拒否', elapsedMs: 800 }),
  ]
  const summary = summarizeRuns(runs, ['災害', '拒否'])

  it('合格数・総数・再試行に頼った問を数える', () => {
    expect(summary.passed).toBe(3)
    expect(summary.total).toBe(4)
    expect(summary.retried).toBe(1)
  })

  it('落としてはいけない分野の失敗は、落ちたチェックまで名指しする', () => {
    expect(summary.criticalFailures).toEqual(['b（「安全」を含まない）'])
  })

  it('分野別は、出てきた順を保つ', () => {
    expect(summary.byCategory).toEqual([
      { category: '駅詳細', passed: 1, total: 1 },
      { category: '災害', passed: 1, total: 2 },
      { category: '拒否', passed: 1, total: 1 },
    ])
  })

  it('所要時間の分位と最大', () => {
    expect(summary.p50Ms).toBe(1200)
    expect(summary.maxMs).toBe(9000)
  })

  it('問が 0 件でも落ちない', () => {
    const empty = summarizeRuns([], ['災害'])
    expect(empty).toMatchObject({ passed: 0, total: 0, retried: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 })
  })
})

describe('レポート', () => {
  const runs: EvalRun[] = [
    run({ id: 'a', elapsedMs: 1200 }),
    run({ id: 'b', pass: false, failedChecks: ['パネル rankingTable が出る'], retried: true }),
  ]
  const report = renderReport(runs, summarizeRuns(runs, ['災害']), {
    label: 'gemini-3.5-flash-lite / temperature 既定',
    baseUrl: 'http://localhost:3411',
    threshold: 36,
    criticalCategories: ['災害'],
  })

  it('見出しに名札・合格率・所要時間・再試行が並ぶ（比べるときに同じ位置で読める）', () => {
    expect(report).toContain('# eval レポート — gemini-3.5-flash-lite / temperature 既定')
    expect(report).toContain('**合格率: 1/2（閾値 36）**')
    expect(report).toContain('再試行に頼った問 1')
    // 2 件 [1.0s, 1.2s]：最近順位法で p50 はランク 1、p95 はランク 2
    expect(report).toContain('p50 1.0s・p95 1.2s・最大 1.2s')
  })

  it('表の行に、所要時間・再試行の印・失敗チェックが出る', () => {
    expect(report).toContain('| 2 | b | 駅詳細 | ❌ | 1.0s | ↻ | 1 | パネル rankingTable が出る |')
  })
})
