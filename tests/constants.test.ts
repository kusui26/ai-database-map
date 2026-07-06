import { describe, expect, it } from 'vitest'
import {
  ACCENT_COLOR,
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS_JA,
  PREFECTURES,
  RADII_M,
  RADIUS_LABELS,
  WARNING_COLOR,
} from '@/shared/constants'

const HEX_COLOR = /^#[0-9a-f]{6}$/

describe('RADII_M', () => {
  it('6 段の半径を厳密昇順・重複なしで保持する', () => {
    expect(RADII_M).toHaveLength(6)
    expect([...RADII_M].sort((a, b) => a - b)).toEqual([...RADII_M])
    expect(new Set(RADII_M).size).toBe(RADII_M.length)
  })

  it('dataset.md の 500m–20km と一致する', () => {
    expect(RADII_M).toEqual([500, 1000, 2000, 5000, 10000, 20000])
  })

  it('全ての半径に表示ラベルがある', () => {
    for (const radius of RADII_M) {
      expect(RADIUS_LABELS[radius]).toMatch(/^\d+(m|km)$/)
    }
  })
})

describe('CATEGORIES', () => {
  it('7 カテゴリを重複なく保持する', () => {
    expect(CATEGORIES).toHaveLength(7)
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length)
  })

  it('全カテゴリに日本語ラベルと配色がある', () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_LABELS_JA[category].length).toBeGreaterThan(0)
      expect(CATEGORY_COLORS[category]).toMatch(HEX_COLOR)
    }
  })
})

describe('配色トークン', () => {
  it('アクセント・警告色が有効な hex', () => {
    expect(ACCENT_COLOR).toMatch(HEX_COLOR)
    expect(WARNING_COLOR).toMatch(HEX_COLOR)
  })
})

describe('PREFECTURES', () => {
  it('47 都道府県をコード昇順・ゼロ埋め 2 桁で保持する', () => {
    expect(PREFECTURES).toHaveLength(47)
    const codes = PREFECTURES.map((prefecture) => prefecture.code)
    expect(new Set(codes).size).toBe(47)
    const expected = Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(2, '0'))
    expect(codes).toEqual(expected)
  })

  it('全ての都道府県名が非空で「都・道・府・県」で終わる', () => {
    for (const prefecture of PREFECTURES) {
      expect(prefecture.name.length).toBeGreaterThan(0)
      expect(prefecture.name).toMatch(/[都道府県]$/)
    }
  })

  it('代表例（東京都 = 13）が正しい', () => {
    expect(PREFECTURES.find((prefecture) => prefecture.code === '13')?.name).toBe('東京都')
  })
})
