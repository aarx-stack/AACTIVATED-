import { describe, it, expect } from 'vitest'
import {
  commissionableRevenue,
  calculateCommission,
  calculateOverrides,
  getUplineChain,
  type Rule,
} from '@/lib/commission'

const order = {
  subtotalCents: 19997,
  discountCents: 2000,
  shippingCents: 1000,
  taxCents: 1550,
  totalCents: 20547,
  marginCents: 13997,
}

describe('commissionableRevenue', () => {
  it('computes each basis', () => {
    expect(commissionableRevenue(order, 'GROSS_TOTAL')).toBe(20547)
    expect(commissionableRevenue(order, 'SUBTOTAL')).toBe(19997)
    expect(commissionableRevenue(order, 'SUBTOTAL_AFTER_DISCOUNT')).toBe(17997)
    expect(commissionableRevenue(order, 'SUBTOTAL_EX_TAX')).toBe(18997)
    expect(commissionableRevenue(order, 'SUBTOTAL_EX_SHIPPING')).toBe(19547)
    expect(commissionableRevenue(order, 'PROFIT')).toBe(13997)
  })
  it('never returns negative revenue', () => {
    expect(
      commissionableRevenue({ subtotalCents: 100, discountCents: 500, shippingCents: 0, taxCents: 0, totalCents: 0 }, 'SUBTOTAL_AFTER_DISCOUNT'),
    ).toBe(0)
  })
})

describe('calculateCommission', () => {
  it('percentage: 30% of commissionable revenue', () => {
    const rules: Rule[] = [{ type: 'PERCENTAGE', rateBps: 3000 }]
    expect(calculateCommission({ rules, revenueCents: 17997 })).toBe(5399)
  })

  it('flat: $25 per order', () => {
    const rules: Rule[] = [{ type: 'FLAT', flatCents: 2500 }]
    expect(calculateCommission({ rules, revenueCents: 17997 })).toBe(2500)
  })

  it('product-specific overrides base rule for matching lines', () => {
    const rules: Rule[] = [
      { type: 'PERCENTAGE', rateBps: 2000 },
      { type: 'PRODUCT_PERCENTAGE', rateBps: 3000, productId: 'prodA' },
      { type: 'PRODUCT_FLAT', flatCents: 4000, productId: 'prodC' },
    ]
    const items = [
      { productId: 'prodA', sku: 'A', quantity: 1, totalCents: 10000 }, // 30% = 3000
      { productId: 'prodC', sku: 'C', quantity: 2, totalCents: 20000 }, // $40 x 2 = 8000
      { productId: 'prodB', sku: 'B', quantity: 1, totalCents: 5000 }, // falls to base 20% = 1000
    ]
    expect(calculateCommission({ rules, revenueCents: 35000, items })).toBe(3000 + 8000 + 1000)
  })

  it('tiered: picks tier by monthly sales', () => {
    const rules: Rule[] = [
      { type: 'TIERED_PERCENTAGE', rateBps: 2000, tierMinCents: 0 },
      { type: 'TIERED_PERCENTAGE', rateBps: 2500, tierMinCents: 500_000 },
      { type: 'TIERED_PERCENTAGE', rateBps: 3000, tierMinCents: 1_000_000 },
      { type: 'TIERED_PERCENTAGE', rateBps: 3500, tierMinCents: 2_500_000 },
    ]
    expect(calculateCommission({ rules, revenueCents: 10000, monthlySalesCents: 0 })).toBe(2000)
    expect(calculateCommission({ rules, revenueCents: 10000, monthlySalesCents: 600_000 })).toBe(2500)
    expect(calculateCommission({ rules, revenueCents: 10000, monthlySalesCents: 1_500_000 })).toBe(3000)
    expect(calculateCommission({ rules, revenueCents: 10000, monthlySalesCents: 9_999_999 })).toBe(3500)
  })

  it('returns 0 with no rules or zero revenue on percentage plans', () => {
    expect(calculateCommission({ rules: [], revenueCents: 10000 })).toBe(0)
    expect(calculateCommission({ rules: [{ type: 'PERCENTAGE', rateBps: 3000 }], revenueCents: 0 })).toBe(0)
  })
})

describe('calculateOverrides', () => {
  const levels = [
    { level: 1, rateBps: 500 },
    { level: 2, rateBps: 300 },
    { level: 3, rateBps: 200 },
  ]

  it('pays each upline level its configured rate', () => {
    // Rep D sells; upline chain: C (L1), B (L2), A (L3)
    const result = calculateOverrides([{ id: 'C' }, { id: 'B' }, { id: 'A' }], levels, 17997)
    expect(result).toEqual([
      { affiliateId: 'C', level: 1, amountCents: 900 }, // 5%
      { affiliateId: 'B', level: 2, amountCents: 540 }, // 3%
      { affiliateId: 'A', level: 3, amountCents: 360 }, // 2%
    ])
  })

  it('stops at chain length and skips unconfigured levels', () => {
    expect(calculateOverrides([{ id: 'C' }], levels, 10000)).toEqual([
      { affiliateId: 'C', level: 1, amountCents: 500 },
    ])
    expect(calculateOverrides([{ id: 'C' }, { id: 'B' }], [{ level: 2, rateBps: 300 }], 10000)).toEqual([
      { affiliateId: 'B', level: 2, amountCents: 300 },
    ])
  })

  it('returns nothing for zero revenue', () => {
    expect(calculateOverrides([{ id: 'C' }], levels, 0)).toEqual([])
  })
})

describe('getUplineChain', () => {
  it('walks up and stops at cycles', async () => {
    const parents: Record<string, string | null> = { D: 'C', C: 'B', B: 'A', A: null }
    const chain = await getUplineChain(async id => parents[id] ?? null, 'D', 5)
    expect(chain).toEqual(['C', 'B', 'A'])
  })
  it('breaks circular relationships', async () => {
    const parents: Record<string, string | null> = { D: 'C', C: 'D' }
    const chain = await getUplineChain(async id => parents[id] ?? null, 'D', 10)
    expect(chain).toEqual(['C'])
  })
  it('respects maxLevels', async () => {
    const parents: Record<string, string | null> = { D: 'C', C: 'B', B: 'A', A: null }
    const chain = await getUplineChain(async id => parents[id] ?? null, 'D', 2)
    expect(chain).toEqual(['C', 'B'])
  })
})
