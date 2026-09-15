/**
 * 正規化（`src/domain/recommend/normalize.ts`）の境界を固定する。
 *
 * ここが狂うと、合成スコアは**単位の大きい指標の言いなり**になる。数式は短いが、
 * 壊れても例外は出ず、順位が静かにずれるだけなので、端と縮退をすべて押さえる。
 */

import { describe, expect, it } from 'vitest'
import { normalize } from '@/domain/recommend/normalize'
import type { NormalizeMethod } from '@/domain/recommend/types'

const ASC = [10, 20, 30] as const
const METHODS: readonly NormalizeMethod[] = ['percentile', 'minmax', 'zscore']

describe('正規化（3 方法）', () => {
  it('percentile は 0〜1 の相対位置になる', () => {
    const { scores, degenerate } = normalize(ASC, 'percentile', 'higher')
    expect([...scores]).toEqual([0, 0.5, 1])
    expect(degenerate).toBeNull()
  })

  it('percentile の同値は平均順位になる（先着順で差を付けない）', () => {
    const { scores } = normalize([10, 10, 30], 'percentile', 'higher')
    expect(scores[0]).toBe(scores[1])
    expect(scores[0]).toBeCloseTo(0.25, 10)
    expect(scores[2]).toBe(1)
  })

  it('minmax は両端が 0 と 1 になる', () => {
    const { scores } = normalize(ASC, 'minmax', 'higher')
    expect([...scores]).toEqual([0, 0.5, 1])
  })

  it('minmax は外れ値に引きずられる（percentile との違いが出る）', () => {
    const outlier = [10, 20, 1000] as const
    const minmax = normalize(outlier, 'minmax', 'higher').scores
    const percentile = normalize(outlier, 'percentile', 'higher').scores
    // 真ん中の 20 は、minmax では下に張り付き、percentile では中央に来る。
    expect(minmax[1] ?? 1).toBeLessThan(0.02)
    expect(percentile[1]).toBe(0.5)
  })

  it('zscore は平均 0・標準偏差 1 に揃う', () => {
    const { scores } = normalize(ASC, 'zscore', 'higher')
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length
    const sd = Math.sqrt(
      scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length,
    )
    expect(mean).toBeCloseTo(0, 10)
    expect(sd).toBeCloseTo(1, 10)
    // 中央値は平均そのものなので 0。並びは昇順のまま。
    expect(scores[1]).toBeCloseTo(0, 10)
    expect(scores[0] ?? 0).toBeLessThan(scores[2] ?? 0)
  })
})

describe('向き（direction）', () => {
  it('lower は 3 方法とも「大きいほど良い」に反転する', () => {
    for (const method of METHODS) {
      const higher = normalize(ASC, method, 'higher').scores
      const lower = normalize(ASC, method, 'lower').scores
      // 反転したので、最小の値がいちばん良くなる。
      expect(lower[0] ?? 0, method).toBeGreaterThan(lower[2] ?? 0)
      expect(higher[0] ?? 0, method).toBeLessThan(higher[2] ?? 0)
    }
  })

  it('0〜1 の方法は 1 から引く／zscore は符号を反転する', () => {
    expect([...normalize(ASC, 'percentile', 'lower').scores]).toEqual([1, 0.5, 0])
    const z = normalize(ASC, 'zscore', 'higher').scores
    const flipped = normalize(ASC, 'zscore', 'lower').scores
    expect(flipped.map((s) => -s)).toEqual([...z])
  })
})

describe('差が付かないときは、そう返す（黙って 0.5 にしない）', () => {
  it('全駅が同値なら no-spread として全員 0.5', () => {
    const { scores, degenerate } = normalize([7, 7, 7], 'minmax', 'higher')
    expect([...scores]).toEqual([0.5, 0.5, 0.5])
    expect(degenerate).toBe('no-spread')
  })

  it('1 駅しかなければ too-few（percentile は割れない）', () => {
    const { scores, degenerate } = normalize([7], 'percentile', 'higher')
    expect([...scores]).toEqual([0.5])
    expect(degenerate).toBe('too-few')
  })

  it('空の入力でも落ちない', () => {
    const { scores, degenerate } = normalize([], 'zscore', 'higher')
    expect([...scores]).toEqual([])
    expect(degenerate).toBe('too-few')
  })

  it('縮退のときは向きを適用しない（0.5 を 0.5 のままにする）', () => {
    // 1 - 0.5 = 0.5 なので値は同じだが、degenerate を握りつぶしていないことを見る。
    const { scores, degenerate } = normalize([7, 7], 'percentile', 'lower')
    expect([...scores]).toEqual([0.5, 0.5])
    expect(degenerate).toBe('no-spread')
  })
})
