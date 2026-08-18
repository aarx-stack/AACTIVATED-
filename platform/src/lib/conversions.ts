// Order → conversion ingestion pipeline.
// verify → log raw webhook → normalize → dedupe → attribute → commission →
// overrides → ledger → outbound webhooks
import { db } from './db'
import { resolveAttribution } from './attribution'
import {
  calculateCommission,
  calculateOverrides,
  commissionableRevenue,
  getUplineChain,
  type Basis,
  type Rule,
} from './commission'
import { getSetting, SETTING_KEYS } from './settings'
import { scoreConversionRisk, recordFraudAlerts, REVIEW_THRESHOLD } from './fraud'
import { queueOutboundWebhook } from './webhooks-out'
import { toCents } from './money'
import { z } from 'zod'

export const orderPayloadSchema = z.object({
  event: z.string().optional(),
  order_id: z.string().min(1),
  customer_id: z.string().optional().nullable(),
  customer_email: z.string().email().optional().nullable(),
  customer_name: z.string().optional().nullable(),
  subtotal: z.union([z.number(), z.string()]),
  discount: z.union([z.number(), z.string()]).optional().default(0),
  shipping: z.union([z.number(), z.string()]).optional().default(0),
  tax: z.union([z.number(), z.string()]).optional().default(0),
  total: z.union([z.number(), z.string()]),
  currency: z.string().optional().default('USD'),
  promo_code: z.string().optional().nullable(),
  affiliate_id: z.string().optional().nullable(),
  click_id: z.string().optional().nullable(),
  products: z
    .array(
      z.object({
        sku: z.string(),
        name: z.string(),
        quantity: z.number().int().positive(),
        unit_price: z.union([z.number(), z.string()]),
      }),
    )
    .optional()
    .default([]),
  created_at: z.string().optional().nullable(),
})

export type OrderPayload = z.infer<typeof orderPayloadSchema>

export interface IngestResult {
  ok: boolean
  duplicate?: boolean
  error?: string
  orderId?: string
  conversionId?: string
  affiliateCode?: string | null
  attributionMethod?: string
  commissionCents?: number
  overrideCents?: number
}

export async function ingestOrder(opts: {
  organizationId: string
  payload: OrderPayload
  source?: string
}): Promise<IngestResult> {
  const { organizationId, payload } = opts
  const placedAt = payload.created_at ? new Date(payload.created_at) : new Date()

  // ── dedupe on external order id ──────────────────────────────────────────
  const existing = await db.order.findUnique({
    where: { organizationId_externalOrderId: { organizationId, externalOrderId: payload.order_id } },
  })
  if (existing) {
    const conv = await db.conversion.findFirst({ where: { orderId: existing.id } })
    return { ok: true, duplicate: true, orderId: existing.id, conversionId: conv?.id }
  }

  // ── upsert customer ──────────────────────────────────────────────────────
  let customer = null
  if (payload.customer_id || payload.customer_email) {
    const externalId = payload.customer_id ?? `email:${payload.customer_email!.toLowerCase()}`
    customer = await db.customer.upsert({
      where: { organizationId_externalId: { organizationId, externalId } },
      create: {
        organizationId,
        externalId,
        email: payload.customer_email?.toLowerCase() ?? null,
        name: payload.customer_name ?? null,
      },
      update: {
        email: payload.customer_email?.toLowerCase() ?? undefined,
        name: payload.customer_name ?? undefined,
      },
    })
  }

  // ── attribution ──────────────────────────────────────────────────────────
  const attribution = await resolveAttribution({
    organizationId,
    affiliateCode: payload.affiliate_id,
    clickId: payload.click_id,
    promoCode: payload.promo_code,
    customerId: customer?.id ?? null,
    orderPlacedAt: placedAt,
  })

  const affiliate = attribution.affiliateId
    ? await db.affiliate.findUnique({
        where: { id: attribution.affiliateId },
        include: { commissionPlan: { include: { rules: true } } },
      })
    : null

  // ── create order + items ─────────────────────────────────────────────────
  const subtotalCents = toCents(payload.subtotal)
  const discountCents = toCents(payload.discount)
  const shippingCents = toCents(payload.shipping)
  const taxCents = toCents(payload.tax)
  const totalCents = toCents(payload.total)

  const order = await db.order.create({
    data: {
      organizationId,
      externalOrderId: payload.order_id,
      customerId: customer?.id ?? null,
      subtotalCents,
      discountCents,
      shippingCents,
      taxCents,
      totalCents,
      currency: payload.currency,
      promoCode: payload.promo_code ?? null,
      source: opts.source ?? 'api',
      placedAt,
    },
  })

  const items: { productId: string | null; sku: string; quantity: number; totalCents: number }[] = []
  let marginCents = 0
  for (const p of payload.products) {
    const unit = toCents(p.unit_price)
    const lineTotal = unit * p.quantity
    const product = await db.product.findUnique({
      where: { organizationId_sku: { organizationId, sku: p.sku } },
    })
    if (product?.costCents != null) marginCents += (unit - product.costCents) * p.quantity
    else marginCents += lineTotal
    await db.orderItem.create({
      data: {
        orderId: order.id,
        productId: product?.id ?? null,
        sku: p.sku,
        name: p.name,
        quantity: p.quantity,
        unitPriceCents: unit,
        totalCents: lineTotal,
      },
    })
    items.push({ productId: product?.id ?? null, sku: p.sku, quantity: p.quantity, totalCents: lineTotal })
  }

  // ── commissionable revenue ───────────────────────────────────────────────
  const basis = (affiliate?.commissionPlan?.basis ??
    (await getSetting(organizationId, SETTING_KEYS.commissionBasis))) as Basis
  const revenueCents = commissionableRevenue(
    { subtotalCents, discountCents, shippingCents, taxCents, totalCents, marginCents },
    basis,
  )

  // ── personal commission ──────────────────────────────────────────────────
  let commissionCents = 0
  if (affiliate?.commissionPlan) {
    const monthStart = new Date(placedAt.getFullYear(), placedAt.getMonth(), 1)
    const monthly = await db.conversion.aggregate({
      where: {
        organizationId,
        affiliateId: affiliate.id,
        convertedAt: { gte: monthStart },
        status: { notIn: ['REJECTED', 'REFUNDED', 'CHARGEBACK'] },
      },
      _sum: { revenueCents: true },
    })
    commissionCents = calculateCommission({
      rules: affiliate.commissionPlan.rules as Rule[],
      revenueCents,
      items,
      monthlySalesCents: monthly._sum.revenueCents ?? 0,
    })
  }

  // ── team overrides ───────────────────────────────────────────────────────
  let overrides: { affiliateId: string; level: number; amountCents: number }[] = []
  if (affiliate) {
    const maxLevels = Number(await getSetting(organizationId, SETTING_KEYS.overrideMaxLevels))
    const levels = await db.overrideLevel.findMany({
      where: { organizationId, isActive: true },
      orderBy: { level: 'asc' },
    })
    const chainIds = await getUplineChain(
      async id => (await db.affiliate.findUnique({ where: { id }, select: { parentId: true } }))?.parentId ?? null,
      affiliate.id,
      maxLevels,
    )
    // only active upline members earn overrides
    const chainAffiliates = await Promise.all(
      chainIds.map(id => db.affiliate.findUnique({ where: { id }, select: { id: true, status: true } })),
    )
    const activeChain = chainAffiliates.filter((a): a is { id: string; status: 'ACTIVE' } => a?.status === 'ACTIVE')
    overrides = calculateOverrides(activeChain, levels, revenueCents)
  }
  const overrideCents = overrides.reduce((s, o) => s + o.amountCents, 0)

  // ── fraud scoring ────────────────────────────────────────────────────────
  const click = attribution.clickRecordId
    ? await db.click.findUnique({ where: { id: attribution.clickRecordId } })
    : null
  const risk = await scoreConversionRisk({
    organizationId,
    affiliateId: affiliate?.id ?? null,
    affiliateEmail: affiliate?.email,
    customerEmail: payload.customer_email,
    clickIp: click?.ipAddress,
    orderTotalCents: totalCents,
  })

  const autoApprove = (await getSetting(organizationId, SETTING_KEYS.autoApproveConversions)) === 'true'
  const reviewRequired = risk.score >= REVIEW_THRESHOLD
  const status = autoApprove && !reviewRequired ? 'APPROVED' : 'PENDING'

  // ── conversion + commissions + ledger, atomically ────────────────────────
  const conversion = await db.$transaction(async tx => {
    const conv = await tx.conversion.create({
      data: {
        organizationId,
        orderId: order.id,
        affiliateId: affiliate?.id ?? null,
        offerId: attribution.offerId,
        campaignId: attribution.campaignId,
        clickRecordId: attribution.clickRecordId,
        status,
        attributionMethod: attribution.method,
        revenueCents,
        grossCents: totalCents,
        commissionCents,
        overrideCents,
        promoCode: payload.promo_code ?? null,
        clickIdRaw: payload.click_id ?? null,
        riskScore: risk.score,
        reviewRequired,
        convertedAt: placedAt,
      },
    })

    if (affiliate && commissionCents > 0) {
      const c = await tx.commission.create({
        data: {
          organizationId,
          conversionId: conv.id,
          affiliateId: affiliate.id,
          type: 'PERSONAL',
          amountCents: commissionCents,
          status: status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          approvedAt: status === 'APPROVED' ? new Date() : null,
        },
      })
      await tx.commissionLedger.create({
        data: {
          organizationId,
          affiliateId: affiliate.id,
          type: 'COMMISSION_EARNED',
          amountCents: commissionCents,
          commissionId: c.id,
          conversionId: conv.id,
          description: `Commission for order ${payload.order_id}`,
        },
      })
    }

    for (const o of overrides) {
      const c = await tx.commission.create({
        data: {
          organizationId,
          conversionId: conv.id,
          affiliateId: o.affiliateId,
          type: 'OVERRIDE',
          overrideLevel: o.level,
          amountCents: o.amountCents,
          status: status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          approvedAt: status === 'APPROVED' ? new Date() : null,
        },
      })
      await tx.commissionLedger.create({
        data: {
          organizationId,
          affiliateId: o.affiliateId,
          type: 'OVERRIDE_EARNED',
          amountCents: o.amountCents,
          commissionId: c.id,
          conversionId: conv.id,
          description: `Level ${o.level} override for order ${payload.order_id}`,
        },
      })
    }

    // promo code usage + lifetime customer attribution
    if (payload.promo_code && attribution.method === 'PROMO_CODE') {
      await tx.promoCode.updateMany({
        where: { organizationId, code: payload.promo_code.trim().toUpperCase() },
        data: { usageCount: { increment: 1 } },
      })
    }
    if (customer && affiliate && !customer.ownerAffiliateId) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { ownerAffiliateId: affiliate.id, ownerAttributedAt: placedAt },
      })
    }

    return conv
  })

  if (reviewRequired) {
    await recordFraudAlerts({
      organizationId,
      affiliateId: affiliate?.id ?? null,
      conversionId: conversion.id,
      signals: risk.signals,
      score: risk.score,
    })
  }

  await queueOutboundWebhook(organizationId, 'conversion.created', {
    conversion_id: conversion.id,
    order_id: payload.order_id,
    affiliate_id: affiliate?.affiliateCode ?? null,
    revenue: revenueCents / 100,
    commission: commissionCents / 100,
    overrides: overrideCents / 100,
    status,
  })

  return {
    ok: true,
    orderId: order.id,
    conversionId: conversion.id,
    affiliateCode: affiliate?.affiliateCode ?? null,
    attributionMethod: attribution.method,
    commissionCents,
    overrideCents,
  }
}
