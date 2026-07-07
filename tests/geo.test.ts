import { describe, expect, it } from 'vitest'
import { circlePolygon } from '@/shared/geo'

describe('circlePolygon', () => {
  it('閉じたリング・segments+1 点・Polygon 型', () => {
    const poly = circlePolygon(139.767, 35.681, 1000, 64)
    expect(poly.type).toBe('Polygon')
    const ring = poly.coordinates[0]
    expect(ring?.length).toBe(65)
    expect(ring?.[0]).toEqual(ring?.[64]) // 先頭と末尾が一致
  })

  it('東端の距離がおおよそ radiusM（cos 補正の検算）', () => {
    const lon = 139.767
    const lat = 35.681
    const radius = 1000
    const ring = circlePolygon(lon, lat, radius, 64).coordinates[0]
    const east = ring?.[0]
    expect(east).toBeDefined()
    const dLonDeg = (east?.[0] ?? lon) - lon
    const meters = dLonDeg * 111_320 * Math.cos((lat * Math.PI) / 180)
    expect(Math.abs(meters - radius)).toBeLessThan(1)
  })

  it('半径が大きいほどリングは広がる', () => {
    const small = circlePolygon(139, 35, 500).coordinates[0]?.[0]
    const large = circlePolygon(139, 35, 20000).coordinates[0]?.[0]
    expect((large?.[0] ?? 0) - 139).toBeGreaterThan((small?.[0] ?? 0) - 139)
  })
})
