// Commission engine — pure functions over integer cents so they can be
// tested exhaustively without a database.
import { applyBps } from './money'

export type Basis =
  | 'GROSS_TOTAL'
  | 'SUBTOTAL'
  | 'SUBTOTAL_AFTER_DISCOUNT'
  | 'SUBTOTAL_EX_TAX'
  | 'SUBTOTAL_EX_SHIPPING'
  | 'PROFIT'

export interface OrderAmounts {
  subtotalCents: number
  discountCents: number
  shippingCents: number
  taxCents: number
  totalCents: number
  /** sum of (unitPrice - cost) * qty when product costs are known */
  marginCents?: number
}

/** Determine the revenue base commissions are calculated on. */
export function commissionableRevenue(order: OrderAmounts, basis: Basis): number {
  switch (basis) {
    case 'GROSS_TOTAL':
      return order.totalCents
    case 'SUBTOTAL':
      return order.subtotalCents
    case 'SUBTOTAL_AFTER_DISCOUNT':
      return Math.max(0, order.subtotalCents - order.discountCents)
    case 'SUBTOTAL_EX_TAX':
      return Math.max(0, order.totalCents - order.taxCents)
    case 'SUBTOTAL_EX_SHIPPING':
      return Math.max(0, order.totalCents - order.shippingCents)
    case 'PROFIT':
      return Math.max(0, order.marginCents ?? Math.max(0, order.subtotalCents - order.discountCents))
  }
}

export type RuleType =
  | 'PERCENTAGE'
  | 'FLAT'
  | 'PRODUCT_PERCENTAGE'
  | 'PRODUCT_FLAT'
  | 'TIERED_PERCENTAGE'

export interface Rule {
  type: RuleType
  rateBps?: number | null
  flatCents?: number | null
  productId?: string | null
  tierMinCents?: number | null
  priority?: number
}

export interface ItemForCommission {
  productId?: string | null
  sku: string
  quantity: number
  totalCents: number // line total after any line-level discount
}

/**
 * Calculate the personal commission for a conversion.
 *
 * Rule resolution:
 *  - Product-specific rules (PRODUCT_PERCENTAGE / PRODUCT_FLAT) apply to matching
 *    line items first; matched line revenue is excluded from the base rules.
 *  - TIERED_PERCENTAGE picks the highest tier whose tierMinCents <= monthlySalesCents.
 *  - Otherwise the highest-priority PERCENTAGE or FLAT rule applies.
 */
export function calculateCommission(opts: {
  rules: Rule[]
  revenueCents: number
  items?: ItemForCommission[]
  /** affiliate's sales this month, for tier selection */
  monthlySalesCents?: number
}): number {
  const { rules, revenueCents } = opts
  const items = opts.items ?? []
  const monthly = opts.monthlySalesCents ?? 0
  if (revenueCents <= 0 && !rules.some(r => r.type === 'FLAT' || r.type === 'PRODUCT_FLAT')) return 0

  let commission = 0
  let remainingRevenue = revenueCents

  // 1. product-specific rules
  const productRules = rules.filter(
    r => (r.type === 'PRODUCT_PERCENTAGE' || r.type === 'PRODUCT_FLAT') && r.productId,
  )
  for (const item of items) {
    if (!item.productId) continue
    const rule = productRules
      .filter(r => r.productId === item.productId)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
    if (!rule) continue
    if (rule.type === 'PRODUCT_PERCENTAGE' && rule.rateBps != null) {
      commission += applyBps(item.totalCents, rule.rateBps)
    } else if (rule.type === 'PRODUCT_FLAT' && rule.flatCents != null) {
      commission += rule.flatCents * item.quantity
    }
    remainingRevenue -= item.totalCents
  }
  remainingRevenue = Math.max(0, remainingRevenue)

  // 2. tiered percentage
  const tierRules = rules
    .filter(r => r.type === 'TIERED_PERCENTAGE' && r.rateBps != null)
    .sort((a, b) => (b.tierMinCents ?? 0) - (a.tierMinCents ?? 0))
  const tier = tierRules.find(r => monthly >= (r.tierMinCents ?? 0))
  if (tier) {
    commission += applyBps(remainingRevenue, tier.rateBps!)
    return commission
  }

  // 3. base percentage / flat
  const base = rules
    .filter(r => r.type === 'PERCENTAGE' || r.type === 'FLAT')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
  if (base) {
    if (base.type === 'PERCENTAGE' && base.rateBps != null) {
      commission += applyBps(remainingRevenue, base.rateBps)
    } else if (base.type === 'FLAT' && base.flatCents != null) {
      commission += base.flatCents
    }
  }
  return commission
}

// ── Team overrides ──────────────────────────────────────────────────────────

export interface OverrideLevelConfig {
  level: number // 1 = direct upline of the selling affiliate
  rateBps: number
}

export interface OverrideResult {
  affiliateId: string
  level: number
  amountCents: number
}

/**
 * Calculate multi-level overrides for an upline chain.
 * `uplineChain[0]` is the direct upline (level 1), etc.
 * Overrides are a percentage of commissionable revenue.
 */
export function calculateOverrides(
  uplineChain: { id: string }[],
  levels: OverrideLevelConfig[],
  revenueCents: number,
): OverrideResult[] {
  const results: OverrideResult[] = []
  if (revenueCents <= 0) return results
  const byLevel = new Map(levels.map(l => [l.level, l.rateBps]))
  uplineChain.forEach((up, idx) => {
    const level = idx + 1
    const rate = byLevel.get(level)
    if (rate == null || rate <= 0) return
    const amount = applyBps(revenueCents, rate)
    if (amount > 0) results.push({ affiliateId: up.id, level, amountCents: amount })
  })
  return results
}

/**
 * Walk up the affiliate hierarchy collecting up to `maxLevels` ancestors,
 * with cycle protection.
 */
export async function getUplineChain(
  getParentId: (id: string) => Promise<string | null>,
  startId: string,
  maxLevels: number,
): Promise<string[]> {
  const chain: string[] = []
  const seen = new Set<string>([startId])
  let current = startId
  for (let i = 0; i < maxLevels; i++) {
    const parentId = await getParentId(current)
    if (!parentId || seen.has(parentId)) break
    chain.push(parentId)
    seen.add(parentId)
    current = parentId
  }
  return chain
}
