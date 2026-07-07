import { describe, expect, it } from 'vitest'
import { formatNumber, formatWithUnit, MISSING } from '@/shared/format'

describe('formatNumber', () => {
  it('int: 3桁区切り・丸め・負号', () => {
    expect(formatNumber(1234567, 'int')).toBe('1,234,567')
    expect(formatNumber(0, 'int')).toBe('0')
    expect(formatNumber(-1500, 'int')).toBe('-1,500')
    expect(formatNumber(6446.4, 'int')).toBe('6,446')
  })

  it('yen: int と同様の桁区切り', () => {
    expect(formatNumber(94600, 'yen')).toBe('94,600')
    expect(formatNumber(41500000, 'yen')).toBe('41,500,000')
  })

  it('decimal1: 小数1桁（四捨五入）', () => {
    expect(formatNumber(12.34, 'decimal1')).toBe('12.3')
    expect(formatNumber(12.86, 'decimal1')).toBe('12.9')
  })

  it('percent1: 既定は自然な符号', () => {
    expect(formatNumber(2.1, 'percent1')).toBe('2.1%')
    expect(formatNumber(-8.4, 'percent1')).toBe('-8.4%')
  })

  it('percent1: signed で正に + を付す・大きい値は桁区切り', () => {
    expect(formatNumber(2.1, 'percent1', { signed: true })).toBe('+2.1%')
    expect(formatNumber(-8.4, 'percent1', { signed: true })).toBe('-8.4%')
    expect(formatNumber(8100, 'percent1', { signed: true })).toBe('+8,100.0%')
  })

  it('ratio1: 0–1 の割合を ×100 して %', () => {
    expect(formatNumber(0.016, 'ratio1')).toBe('1.6%')
    expect(formatNumber(1, 'ratio1')).toBe('100.0%')
    expect(formatNumber(0, 'ratio1')).toBe('0.0%')
  })

  it('欠損（null/NaN/undefined）は —', () => {
    expect(formatNumber(null, 'int')).toBe(MISSING)
    expect(formatNumber(Number.NaN, 'percent1')).toBe(MISSING)
    expect(formatNumber(undefined, 'yen')).toBe(MISSING)
  })
})

describe('formatWithUnit', () => {
  it('単位を後置（% は数値に含むため重複回避）', () => {
    expect(formatWithUnit(94600, 'yen', '円/㎡')).toBe('94,600 円/㎡')
    expect(formatWithUnit(6000, 'int', '人')).toBe('6,000 人')
    expect(formatWithUnit(2.1, 'percent1', '%')).toBe('2.1%')
    expect(formatWithUnit(null, 'int', '人')).toBe(MISSING)
  })
})
