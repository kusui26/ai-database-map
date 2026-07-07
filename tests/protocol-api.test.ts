import { describe, expect, it } from 'vitest'
import { mapResponseSchema, panelSchema } from '@/shared/protocol'
import { errorEnvelopeSchema, growthQuerySchema, rankingQuerySchema } from '@/shared/api'

describe('GUI Chat Protocol', () => {
  it('MapResponse をパース（flyTo / clearOverlays / markdown）', () => {
    const parsed = mapResponseSchema.parse({
      messages: [{ role: 'assistant', text: 'こんにちは' }],
      mapActions: [
        { type: 'flyTo', lon: 139.767, lat: 35.681, zoom: 12 },
        { type: 'clearOverlays' },
      ],
      panels: [{ type: 'markdown', body: '本文', placement: 'inline' }],
    })
    expect(parsed.mapActions[0]?.type).toBe('flyTo')
    expect(parsed.panels[0]?.type).toBe('markdown')
  })

  it('trendChart パネル（系列・フラグ）をパース', () => {
    const panel = panelSchema.parse({
      type: 'trendChart',
      title: '人口',
      unit: '人',
      flags: [{ label: '低基準', level: 'warn' }],
      series: [
        {
          label: '実績',
          points: [
            { x: 2020, y: 6000 },
            { x: 2015, y: null },
          ],
        },
      ],
    })
    expect(panel.type).toBe('trendChart')
  })

  it('未知の panel type を拒否', () => {
    expect(() => panelSchema.parse({ type: 'unknown' })).toThrow()
  })
})

describe('API クエリ入力', () => {
  it('ranking: limit を coerce・既定 order・上限50', () => {
    expect(rankingQuerySchema.parse({ metric: 'x', limit: '10' }).limit).toBe(10)
    expect(rankingQuerySchema.parse({ metric: 'x' }).order).toBe('desc')
    expect(() => rankingQuerySchema.parse({ metric: 'x', limit: '999' })).toThrow()
  })

  it('growth: excludeLowN 文字列→真偽', () => {
    expect(growthQuerySchema.parse({ x: 'a', y: 'b', excludeLowN: 'true' }).excludeLowN).toBe(true)
    expect(growthQuerySchema.parse({ x: 'a', y: 'b', excludeLowN: '1' }).excludeLowN).toBe(true)
    expect(growthQuerySchema.parse({ x: 'a', y: 'b' }).excludeLowN).toBe(false)
  })

  it('errorEnvelope', () => {
    expect(
      errorEnvelopeSchema.parse({ error: { code: 'BAD_METRIC', message: 'm' } }).error.code,
    ).toBe('BAD_METRIC')
  })
})
