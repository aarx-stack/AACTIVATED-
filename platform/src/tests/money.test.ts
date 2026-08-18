import { describe, it, expect } from 'vitest'
import { toCents, centsToDecimal, formatCents, applyBps, proRata } from '@/lib/money'

describe('toCents', () => {
  it('converts decimal amounts to integer cents', () => {
    expect(toCents(199.97)).toBe(19997)
    expect(toCents('199.97')).toBe(19997)
    expect(toCents(0)).toBe(0)
    expect(toCents(10)).toBe(1000)
    expect(toCents('10.5')).toBe(1050)
  })
  it('avoids floating point drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30) // 0.30000000000000004
    expect(toCents(1.005)).toBe(101) // rounds correctly, no 1.00499999 issue
    expect(toCents(205.47)).toBe(20547)
  })
  it('handles negatives and rejects garbage', () => {
    expect(toCents(-20)).toBe(-2000)
    expect(toCents(null)).toBe(0)
    expect(toCents(undefined)).toBe(0)
    expect(() => toCents('abc')).toThrow()
    expect(() => toCents('12.3.4')).toThrow()
  })
})

describe('centsToDecimal / formatCents', () => {
  it('formats cents', () => {
    expect(centsToDecimal(19997)).toBe('199.97')
    expect(centsToDecimal(5)).toBe('0.05')
    expect(centsToDecimal(-1050)).toBe('-10.50')
    expect(formatCents(19997)).toBe('$199.97')
    expect(formatCents(-500)).toBe('-$5.00')
  })
})

describe('applyBps', () => {
  it('applies basis-point rates exactly', () => {
    expect(applyBps(10000, 3000)).toBe(3000) // 30% of $100
    expect(applyBps(19997, 3000)).toBe(5999) // 30% of $199.97 = $59.991 -> 59.99
    expect(applyBps(1, 5000)).toBe(1) // rounds half up
    expect(applyBps(0, 3000)).toBe(0)
  })
  it('handles negative amounts symmetrically', () => {
    expect(applyBps(-19997, 3000)).toBe(-5999)
  })
})

describe('proRata', () => {
  it('allocates proportionally', () => {
    // reverse 50% of a $59.99 commission on a half refund
    expect(proRata(5999, 10000, 20000)).toBe(3000)
    expect(proRata(5999, 20000, 20000)).toBe(5999)
    expect(proRata(100, 1, 3)).toBe(33)
  })
  it('handles zero total', () => {
    expect(proRata(5999, 100, 0)).toBe(0)
  })
})
