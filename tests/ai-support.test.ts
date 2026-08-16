/**
 * src/ai の補助（純関数）：レート制限とカタログダイジェスト。
 * どちらも DB/LLM 非依存で、ガードとツール記述の土台を担保する。
 */

import { describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimitStore } from '@/ai/rate-limit'
import {
  baseMetricDetail,
  categoryDigests,
  metricsCatalogDigest,
  systemCatalogSummary,
} from '@/ai/catalog-digest'
import { suggestMetricKeys } from '@/ai/metric-resolver'

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
  it('categoryDigests は 9 カテゴリを網羅し、各 baseMetric に例キーがある', () => {
    const digests = categoryDigests()
    expect(digests).toHaveLength(9)
    const population = digests.find((digest) => digest.category === 'population')
    expect(population?.labelJa).toBe('人口')
    for (const base of population?.baseMetrics ?? []) {
      expect(base.exampleKey.length).toBeGreaterThan(0)
    }
  })

  it('baseMetricDetail は変種を列挙せず、半径一覧 × 年一覧 ＋ 既定キーに畳む', () => {
    const detail = baseMetricDetail('pop_gr')
    expect(detail.variantCount).toBeGreaterThan(20) // 実データは 54 変種
    expect(detail.radii).toEqual([500, 1000, 2000, 5000, 10000, 20000])
    expect(detail.years).toContain('2015→2020')
    expect(detail.defaultKey).toBe('pop_gr_2020_2015_1km')
    expect(detail.usage).toContain('metric="pop_gr"')
  })

  it('baseMetricDetail の返却量は変種の全列挙より 1 桁小さい', () => {
    // 旧実装は pop_gr で約 7.4KB（≈2,400 トークン）。往復ごとに文脈へ積み上がっていた。
    const size = JSON.stringify(baseMetricDetail('pop_gr')).length
    expect(size).toBeLessThan(1000)
  })

  it('将来推計は推計時点（vintage）も返す', () => {
    const detail = baseMetricDetail('pop_pred')
    expect(detail.vintages).toContain(2024)
  })

  it('半径非依存の指標は radii が空', () => {
    const detail = baseMetricDetail('pax_rate') // rate_yoy / rate_covid
    expect(detail.radii).toEqual([])
    expect(detail.variantCount).toBe(2)
  })

  it('metricsCatalogDigest：baseMetric 指定で詳細、無指定で categories', () => {
    const byBase = JSON.stringify(metricsCatalogDigest({ baseMetric: 'pop_gr' }))
    expect(byBase).toContain('pop_gr_2020_2015_1km') // 既定キー
    const top = JSON.stringify(metricsCatalogDigest({}))
    expect(top).toContain('categories')
    expect(top).toContain('人口')
  })

  it('suggestMetricKeys は近い baseMetric の候補を返す（不正キーの再案内）', () => {
    const suggestions = suggestMetricKeys('pop_gr_zzz')
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.every((key) => key.startsWith('pop'))).toBe(true)
  })

  it('systemCatalogSummary はカテゴリ英名と、ツールに渡すファミリ名を含む', () => {
    const summary = systemCatalogSummary()
    expect(summary).toContain('(population)')
    expect(summary).toContain('[pop_gr｜') // キーではなくファミリ名を提示する
    // 半径非依存で少数のファミリ（意味の異なる指標が同居）はキーを列挙する
    expect(summary).toContain('rate_yoy/rate_covid')
  })
})
