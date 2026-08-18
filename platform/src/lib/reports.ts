import { db } from './db'

export async function affiliateReport(organizationId: string, from: Date, to: Date) {
  const affiliates = await db.affiliate.findMany({
    where: { organizationId },
    select: { id: true, affiliateCode: true, firstName: true, lastName: true },
  })
  const rows = []
  for (const a of affiliates) {
    const [clicks, convAgg] = await Promise.all([
      db.click.count({ where: { affiliateId: a.id, createdAt: { gte: from, lte: to } } }),
      db.conversion.aggregate({
        where: {
          affiliateId: a.id,
          convertedAt: { gte: from, lte: to },
          status: { notIn: ['REJECTED'] },
        },
        _sum: { revenueCents: true, commissionCents: true },
        _count: true,
      }),
    ])
    const revenue = convAgg._sum.revenueCents ?? 0
    const orders = convAgg._count
    rows.push({
      affiliate_id: a.affiliateCode,
      name: `${a.firstName} ${a.lastName}`,
      clicks,
      orders,
      revenue: revenue / 100,
      commission: (convAgg._sum.commissionCents ?? 0) / 100,
      conversion_rate: clicks > 0 ? Number(((orders / clicks) * 100).toFixed(2)) : 0,
      epc: clicks > 0 ? Number((revenue / 100 / clicks).toFixed(2)) : 0,
      aov: orders > 0 ? Number((revenue / 100 / orders).toFixed(2)) : 0,
    })
  }
  return rows.sort((a, b) => b.revenue - a.revenue)
}

export async function productReport(organizationId: string, from: Date, to: Date) {
  const items = await db.orderItem.findMany({
    where: { order: { organizationId, placedAt: { gte: from, lte: to } } },
    select: { sku: true, name: true, quantity: true, totalCents: true },
  })
  const bySku = new Map<string, { sku: string; name: string; units: number; revenueCents: number }>()
  for (const i of items) {
    const row = bySku.get(i.sku) ?? { sku: i.sku, name: i.name, units: 0, revenueCents: 0 }
    row.units += i.quantity
    row.revenueCents += i.totalCents
    bySku.set(i.sku, row)
  }
  return [...bySku.values()]
    .map(r => ({ sku: r.sku, name: r.name, units: r.units, revenue: r.revenueCents / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
}

export async function financialReport(organizationId: string, from: Date, to: Date) {
  const [orders, commissions, overrides, refunds] = await Promise.all([
    db.order.aggregate({
      where: { organizationId, placedAt: { gte: from, lte: to } },
      _sum: { totalCents: true, subtotalCents: true, discountCents: true, refundedCents: true },
      _count: true,
    }),
    db.commission.aggregate({
      where: { organizationId, type: 'PERSONAL', createdAt: { gte: from, lte: to } },
      _sum: { amountCents: true, reversedCents: true },
    }),
    db.commission.aggregate({
      where: { organizationId, type: 'OVERRIDE', createdAt: { gte: from, lte: to } },
      _sum: { amountCents: true, reversedCents: true },
    }),
    db.order.aggregate({
      where: { organizationId, placedAt: { gte: from, lte: to }, refundedCents: { gt: 0 } },
      _count: true,
    }),
  ])
  const gross = orders._sum.totalCents ?? 0
  const refunded = orders._sum.refundedCents ?? 0
  const personal = (commissions._sum.amountCents ?? 0) - (commissions._sum.reversedCents ?? 0)
  const override = (overrides._sum.amountCents ?? 0) - (overrides._sum.reversedCents ?? 0)
  return {
    orders: orders._count,
    gross_revenue: gross / 100,
    discounts: (orders._sum.discountCents ?? 0) / 100,
    refunds: refunded / 100,
    refund_count: refunds._count,
    net_revenue: (gross - refunded) / 100,
    affiliate_commissions: personal / 100,
    override_commissions: override / 100,
    net_company_revenue: (gross - refunded - personal - override) / 100,
  }
}
