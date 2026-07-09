import { describe, expect, it } from 'vitest'
import { entries } from '@/shared/catalog'
import { dataSources } from '@/domain/sources'

describe('dataSources（出典表）', () => {
  const sources = dataSources()

  it('受け入れ基準の出典コードを網羅（S12/国勢調査/L01/P11/P36/経済センサス）', () => {
    const blob = sources.map((s) => s.source).join('\n')
    for (const code of ['S12', '国勢調査', 'L01', 'P11', 'P36', '経済センサス']) {
      expect(blob).toContain(code)
    }
  })

  it('各出典は網羅カテゴリ・ラベル・指標数・ライセンス文言を持つ', () => {
    expect(sources.length).toBeGreaterThanOrEqual(6)
    for (const s of sources) {
      expect(s.categories.length).toBeGreaterThan(0)
      expect(s.categoryLabels.length).toBe(s.categories.length)
      expect(s.metricCount).toBeGreaterThan(0)
      expect(s.license.length).toBeGreaterThan(0)
    }
  })

  it('商用制限のある出典（バス2010 の分母）を nonCommercial=true で示す', () => {
    const nonCommercial = sources.filter((s) => s.nonCommercial)
    expect(nonCommercial.length).toBeGreaterThanOrEqual(1)
    expect(nonCommercial.some((s) => /P11|バス/.test(s.source))).toBe(true)
  })

  it('指標数の総和は全 entries に一致（漏れなく分類）', () => {
    const total = sources.reduce((sum, s) => sum + s.metricCount, 0)
    expect(total).toBe(entries.length)
  })
})
