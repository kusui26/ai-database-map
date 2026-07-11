/**
 * src/ai の補助（純関数）：レート制限とカタログダイジェスト。
 * どちらも DB/LLM 非依存で、ガードとツール記述の土台を担保する。
 */

import { describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimitStore } from '@/ai/rate-limit'
import {
  categoryDigests,
  metricsCatalogDigest,
  suggestMetricKeys,
  systemCatalogSummary,
  variantsForBaseMetric,
} from '@/ai/catalog-digest'

describe('checkRateLimit（固定窓・now 注入で純粋）', () => {
  it('上限までは許可し、超過で拒否＋retryAfter を返す', () => {
    resetRateLimitStore()
    const opts = { limit: 2, windowMs: 1000, now: 0 }
    expect(checkRateLimit('ip-a', opts).ok).toBe(true) // 1
    expect(checkRateLimit('ip-a', opts).ok).toBe(true) // 2
    const third = checkRateLimit('ip-a', opts)
    expect(third.ok).toBe(false)
    expect(third.retryAfterMs).toBe(1000)
  })

  it('窓を跨ぐとリセットされる', () => {
    resetRateLimitStore()
    expect(checkRateLimit('ip-b', { limit: 1, windowMs: 1000, now: 0 }).ok).toBe(true)
    expect(checkRateLimit('ip-b', { limit: 1, windowMs: 1000, now: 500 }).ok).toBe(false)
    expect(checkRateLimit('ip-b', { limit: 1, windowMs: 1000, now: 1000 }).ok).toBe(true)
  })

  it('キー（IP）ごとに独立', () => {
    resetRateLimitStore()
    const opts = { limit: 1, windowMs: 1000, now: 0 }
    expect(checkRateLimit('ip-c', opts).ok).toBe(true)
    expect(checkRateLimit('ip-d', opts).ok).toBe(true)
  })
})

describe('catalog-digest（カタログ駆動）', () => {
  it('categoryDigests は 7 カテゴリを網羅し、各 baseMetric に例キーがある', () => {
    const digests = categoryDigests()
    expect(digests).toHaveLength(7)
    const population = digests.find((digest) => digest.category === 'population')
    expect(population?.labelJa).toBe('人口')
    for (const base of population?.baseMetrics ?? []) {
      expect(base.exampleKey.length).toBeGreaterThan(0)
    }
  })

  it('variantsForBaseMetric は正確なキーを返す（rank/compare にそのまま渡せる）', () => {
    const variants = variantsForBaseMetric('pop_gr')
    expect(variants.length).toBeGreaterThan(0)
    expect(variants.some((variant) => variant.key === 'pop_gr_2020_2015_1km')).toBe(true)
    // 半径つきの変種を持つ
    expect(variants.some((variant) => variant.radiusM === 1000)).toBe(true)
  })

  it('metricsCatalogDigest：baseMetric 指定で variants、無指定で categories', () => {
    const byBase = JSON.stringify(metricsCatalogDigest({ baseMetric: 'pop_gr' }))
    expect(byBase).toContain('pop_gr_2020_2015_1km')
    const top = JSON.stringify(metricsCatalogDigest({}))
    expect(top).toContain('categories')
    expect(top).toContain('人口')
  })

  it('suggestMetricKeys は近い baseMetric の候補を返す（不正キーの再案内）', () => {
    const suggestions = suggestMetricKeys('pop_gr_zzz')
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.every((key) => key.startsWith('pop'))).toBe(true)
  })

  it('systemCatalogSummary はカテゴリ英名と例キーを含む', () => {
    const summary = systemCatalogSummary()
    expect(summary).toContain('(population)')
    expect(summary).toContain('例:')
  })
})
