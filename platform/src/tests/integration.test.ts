// Integration tests exercising the real pipeline against the dev database.
// Requires DATABASE_URL (run `prisma migrate dev` first).
import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '@/lib/db'
import { ingestOrder } from '@/lib/conversions'
import { processRefund } from '@/lib/refunds'
import { newAffiliateCode, newReferralCode, randomToken } from '@/lib/ids'
import { setSetting } from '@/lib/settings'

const run = randomToken(6)
let orgId: string
let distributorId: string
let repMidId: string
let repId: string
let repCode: string

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Test Org ${run}`, slug: `test-${run}` },
  })
  orgId = org.id
  await setSetting(orgId, 'conversions.auto_approve', 'true')
  for (const [level, rateBps] of [[1, 500], [2, 300], [3, 200]] as const) {
    await db.overrideLevel.create({ data: { organizationId: orgId, level, rateBps } })
  }
  const plan = await db.commissionPlan.create({
    data: {
      organizationId: orgId,
      name: 'Test 30%',
      basis: 'SUBTOTAL_AFTER_DISCOUNT',
      rules: { create: [{ type: 'PERCENTAGE', rateBps: 3000 }] },
    },
  })
  const mkAff = (first: string, parentId?: string) =>
    db.affiliate.create({
      data: {
        organizationId: orgId,
        affiliateCode: newAffiliateCode(),
        referralCode: newReferralCode(),
        firstName: first,
        lastName: 'Test',
        email: `${first.toLowerCase()}-${run}@test.example`,
        status: 'ACTIVE',
        commissionPlanId: plan.id,
        parentId: parentId ?? null,
      },
    })
  const distributor = await mkAff('Distributor')
  distributorId = distributor.id
  const mid = await mkAff('Mid', distributor.id)
  repMidId = mid.id
  const rep = await mkAff('Seller', mid.id)
  repId = rep.id
  repCode = rep.referralCode
})

afterAll(async () => {
  await db.$disconnect()
})

describe('order ingestion pipeline', () => {
  const orderId = `TEST-${run}-1`

  it('creates conversion, commission, and overrides for an attributed order', async () => {
    const result = await ingestOrder({
      organizationId: orgId,
      payload: {
        event: 'order.completed',
        order_id: orderId,
        customer_email: `buyer-${run}@test.example`,
        subtotal: 200,
        discount: 20,
        shipping: 10,
        tax: 15.5,
        total: 205.5,
        currency: 'USD',
        promo_code: null,
        affiliate_id: repCode,
        click_id: null,
        products: [{ sku: 'X-1', name: 'Test Product', quantity: 1, unit_price: 200 }],
        created_at: new Date().toISOString(),
      },
    })
    expect(result.ok).toBe(true)
    expect(result.attributionMethod).toBe('EXPLICIT_AFFILIATE_ID')
    // commissionable = (20000 - 2000) = 18000; 30% = 5400
    expect(result.commissionCents).toBe(5400)
    // overrides: L1 (Mid) 5% = 900, L2 (Distributor) 3% = 540
    expect(result.overrideCents).toBe(900 + 540)

    const commissions = await db.commission.findMany({
      where: { conversion: { orderId: result.orderId! } },
    })
    expect(commissions).toHaveLength(3)
    const override1 = commissions.find(c => c.overrideLevel === 1)
    expect(override1?.affiliateId).toBe(repMidId)
    const override2 = commissions.find(c => c.overrideLevel === 2)
    expect(override2?.affiliateId).toBe(distributorId)

    const ledger = await db.commissionLedger.findMany({ where: { conversionId: result.conversionId! } })
    expect(ledger.map(l => l.amountCents).sort((a, b) => a - b)).toEqual([540, 900, 5400])
  })

  it('is idempotent on duplicate order ids', async () => {
    const result = await ingestOrder({
      organizationId: orgId,
      payload: {
        order_id: orderId,
        subtotal: 200, discount: 0, shipping: 0, tax: 0, total: 200,
        currency: 'USD', products: [],
      },
    })
    expect(result.ok).toBe(true)
    expect(result.duplicate).toBe(true)
    const orders = await db.order.count({ where: { organizationId: orgId, externalOrderId: orderId } })
    expect(orders).toBe(1)
  })

  it('records lifetime customer attribution and applies it to later orders', async () => {
    const result = await ingestOrder({
      organizationId: orgId,
      payload: {
        order_id: `TEST-${run}-repeat`,
        customer_email: `buyer-${run}@test.example`, // same customer, no explicit ref
        subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 100,
        currency: 'USD', products: [],
      },
    })
    expect(result.ok).toBe(true)
    expect(['CUSTOMER_OWNER', 'COOKIE']).toContain(result.attributionMethod)
    expect(result.commissionCents).toBe(3000) // 30% of $100
  })
})

describe('refund reversal', () => {
  it('fully reverses commissions and overrides with negative ledger entries', async () => {
    const orderId = `TEST-${run}-refund`
    await ingestOrder({
      organizationId: orgId,
      payload: {
        order_id: orderId,
        subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 100,
        currency: 'USD', affiliate_id: repCode, products: [],
      },
    })
    const result = await processRefund({ organizationId: orgId, externalOrderId: orderId, kind: 'REFUND' })
    expect(result.ok).toBe(true)
    // personal 3000 + overrides 500 + 300 = 3800 reversed
    expect(result.reversedCents).toBe(3800)

    const order = await db.order.findUnique({
      where: { organizationId_externalOrderId: { organizationId: orgId, externalOrderId: orderId } },
      include: { conversions: { include: { commissions: true } } },
    })
    expect(order?.status).toBe('REFUNDED')
    for (const c of order!.conversions[0].commissions) {
      expect(c.status).toBe('REVERSED')
      expect(c.reversedCents).toBe(c.amountCents)
    }
    // ledger must contain balancing negatives, history intact
    const ledger = await db.commissionLedger.findMany({
      where: { conversionId: order!.conversions[0].id },
    })
    const sum = ledger.reduce((s, l) => s + l.amountCents, 0)
    expect(sum).toBe(0)
    expect(ledger.length).toBe(6) // 3 earned + 3 reversals
  })

  it('reverses proportionally on partial refunds', async () => {
    const orderId = `TEST-${run}-partial`
    await ingestOrder({
      organizationId: orgId,
      payload: {
        order_id: orderId,
        subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 100,
        currency: 'USD', affiliate_id: repCode, products: [],
      },
    })
    // refund half: $50 of $100
    const result = await processRefund({
      organizationId: orgId, externalOrderId: orderId, refundAmount: 5000, kind: 'REFUND',
    })
    expect(result.ok).toBe(true)
    // half of 3000 + half of 500 + half of 300 = 1900
    expect(result.reversedCents).toBe(1900)
    const order = await db.order.findUnique({
      where: { organizationId_externalOrderId: { organizationId: orgId, externalOrderId: orderId } },
    })
    expect(order?.status).toBe('PARTIALLY_REFUNDED')
    // second refund of the remaining half completes the reversal
    const second = await processRefund({
      organizationId: orgId, externalOrderId: orderId, refundAmount: 5000, kind: 'REFUND',
    })
    expect(second.reversedCents).toBe(1900)
    const third = await processRefund({
      organizationId: orgId, externalOrderId: orderId, refundAmount: 5000, kind: 'REFUND',
    })
    expect(third.ok).toBe(false) // nothing left to refund
  })
})

describe('promo code attribution', () => {
  it('attributes orders carrying an affiliate promo code', async () => {
    await db.promoCode.create({
      data: { organizationId: orgId, code: `PROMO${run.toUpperCase()}`, affiliateId: repId, discountBps: 1000 },
    })
    const result = await ingestOrder({
      organizationId: orgId,
      payload: {
        order_id: `TEST-${run}-promo`,
        customer_email: `promo-buyer-${run}@test.example`,
        subtotal: 100, discount: 10, shipping: 0, tax: 0, total: 90,
        currency: 'USD', promo_code: `PROMO${run.toUpperCase()}`, products: [],
      },
    })
    expect(result.ok).toBe(true)
    expect(result.attributionMethod).toBe('PROMO_CODE')
    expect(result.commissionCents).toBe(2700) // 30% of (100-10)
  })

  it('leaves unattributable orders unattributed with zero commission', async () => {
    const result = await ingestOrder({
      organizationId: orgId,
      payload: {
        order_id: `TEST-${run}-direct`,
        subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 100,
        currency: 'USD', products: [],
      },
    })
    expect(result.ok).toBe(true)
    expect(result.attributionMethod).toBe('UNATTRIBUTED')
    expect(result.commissionCents).toBe(0)
    expect(result.overrideCents).toBe(0)
  })
})
