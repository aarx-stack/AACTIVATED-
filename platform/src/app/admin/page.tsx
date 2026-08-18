import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { Card, CardHeader, StatCard, Table, Td, EmptyRow, PageHeader } from '@/components/ui'
import { RevenueChart, ConversionsChart, type TimePoint } from '@/components/charts'

const RANGES: Record<string, { label: string; days?: number }> = {
  today: { label: 'Today' },
  yesterday: { label: 'Yesterday' },
  '7d': { label: 'Last 7 Days', days: 7 },
  '30d': { label: 'Last 30 Days', days: 30 },
  month: { label: 'This Month' },
  'last-month': { label: 'Last Month' },
}

function rangeToDates(range: string, from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  switch (range) {
    case 'today':
      return { start: startOfDay(now), end: now }
    case 'yesterday': {
      const y = startOfDay(new Date(now.getTime() - 86_400_000))
      return { start: y, end: new Date(y.getTime() + 86_400_000 - 1) }
    }
    case 'month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    case 'last-month':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
      }
    case 'custom':
      if (from && to) return { start: new Date(from), end: new Date(`${to}T23:59:59`) }
      return { start: new Date(now.getTime() - 30 * 86_400_000), end: now }
    default: {
      const days = RANGES[range]?.days ?? 30
      return { start: new Date(now.getTime() - days * 86_400_000), end: now }
    }
  }
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>
}) {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId
  const sp = await searchParams
  const range = sp.range ?? '30d'
  const { start, end } = rangeToDates(range, sp.from, sp.to)

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86_400_000)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const revenueSince = (since: Date) =>
    db.order.aggregate({ where: { organizationId: orgId, placedAt: { gte: since } }, _sum: { totalCents: true } })

  const [revToday, revWeek, revMonth, clicksAgg, uniqueIps, convAgg, commAgg, overrideAgg, refundAgg, topAffiliates, recentConversions] =
    await Promise.all([
      revenueSince(todayStart),
      revenueSince(weekStart),
      revenueSince(monthStart),
      db.click.count({ where: { organizationId: orgId, createdAt: { gte: start, lte: end } } }),
      db.click.groupBy({ by: ['ipAddress'], where: { organizationId: orgId, createdAt: { gte: start, lte: end } } }),
      db.conversion.aggregate({
        where: { organizationId: orgId, convertedAt: { gte: start, lte: end }, status: { notIn: ['REJECTED'] } },
        _sum: { grossCents: true, revenueCents: true },
        _count: true,
      }),
      db.commission.aggregate({
        where: { organizationId: orgId, type: 'PERSONAL', createdAt: { gte: start, lte: end } },
        _sum: { amountCents: true, reversedCents: true },
      }),
      db.commission.aggregate({
        where: { organizationId: orgId, type: 'OVERRIDE', createdAt: { gte: start, lte: end } },
        _sum: { amountCents: true, reversedCents: true },
      }),
      db.order.aggregate({
        where: { organizationId: orgId, placedAt: { gte: start, lte: end } },
        _sum: { refundedCents: true, totalCents: true },
      }),
      db.conversion.groupBy({
        by: ['affiliateId'],
        where: { organizationId: orgId, convertedAt: { gte: start, lte: end }, affiliateId: { not: null }, status: { notIn: ['REJECTED'] } },
        _sum: { revenueCents: true },
        _count: true,
        orderBy: { _sum: { revenueCents: 'desc' } },
        take: 5,
      }),
      db.conversion.findMany({
        where: { organizationId: orgId },
        orderBy: { convertedAt: 'desc' },
        take: 8,
        include: { affiliate: true, order: true },
      }),
    ])

  const affiliateNames = new Map(
    (
      await db.affiliate.findMany({
        where: { id: { in: topAffiliates.map(t => t.affiliateId!).filter(Boolean) } },
        select: { id: true, firstName: true, lastName: true, affiliateCode: true },
      })
    ).map(a => [a.id, `${a.firstName} ${a.lastName}`]),
  )

  // daily time series
  const conversions = await db.conversion.findMany({
    where: { organizationId: orgId, convertedAt: { gte: start, lte: end }, status: { notIn: ['REJECTED'] } },
    select: { convertedAt: true, grossCents: true },
  })
  const byDay = new Map<string, { revenue: number; conversions: number }>()
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    byDay.set(d.toISOString().slice(5, 10), { revenue: 0, conversions: 0 })
  }
  for (const c of conversions) {
    const key = c.convertedAt.toISOString().slice(5, 10)
    const row = byDay.get(key) ?? { revenue: 0, conversions: 0 }
    row.revenue += c.grossCents / 100
    row.conversions += 1
    byDay.set(key, row)
  }
  const series: TimePoint[] = [...byDay.entries()].map(([date, v]) => ({
    date,
    revenue: Number(v.revenue.toFixed(2)),
    conversions: v.conversions,
  }))

  const clicks = clicksAgg
  const convCount = convAgg._count
  const gross = refundAgg._sum.totalCents ?? 0
  const refunded = refundAgg._sum.refundedCents ?? 0
  const commissions = (commAgg._sum.amountCents ?? 0) - (commAgg._sum.reversedCents ?? 0)
  const overrides = (overrideAgg._sum.amountCents ?? 0) - (overrideAgg._sum.reversedCents ?? 0)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Performance overview"
        action={
          <div className="flex flex-wrap gap-1">
            {Object.entries(RANGES).map(([key, r]) => (
              <Link
                key={key}
                href={`/admin?range=${key}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  range === key
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700'
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Revenue Today" value={formatCents(revToday._sum.totalCents ?? 0)} />
        <StatCard label="Revenue This Week" value={formatCents(revWeek._sum.totalCents ?? 0)} />
        <StatCard label="Revenue This Month" value={formatCents(revMonth._sum.totalCents ?? 0)} />
        <StatCard label="Clicks" value={String(clicks)} sub={`${uniqueIps.length} unique`} />
        <StatCard label="Conversions" value={String(convCount)} sub={`${clicks > 0 ? ((convCount / clicks) * 100).toFixed(1) : '0.0'}% CVR`} />
        <StatCard label="Avg Order Value" value={convCount > 0 ? formatCents(Math.round(gross / Math.max(1, convCount))) : '$0.00'} />
        <StatCard label="Affiliate Commissions" value={formatCents(commissions)} />
        <StatCard label="Team Overrides" value={formatCents(overrides)} />
        <StatCard label="Refunds" value={formatCents(refunded)} />
        <StatCard label="Net Revenue" value={formatCents(gross - refunded)} />
        <StatCard label="Net After Commissions" value={formatCents(gross - refunded - commissions - overrides)} />
        <StatCard label="EPC" value={clicks > 0 ? formatCents(Math.round(gross / clicks)) : '$0.00'} sub="earnings per click" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue over time" />
          <RevenueChart data={series} />
        </Card>
        <Card>
          <CardHeader title="Conversions over time" />
          <ConversionsChart data={series} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top affiliates" subtitle="By revenue in selected range" />
          <Table headers={['Affiliate', 'Conversions', 'Revenue']}>
            {topAffiliates.length === 0 && <EmptyRow cols={3} message="No conversions yet" />}
            {topAffiliates.map(t => (
              <tr key={t.affiliateId}>
                <Td>{affiliateNames.get(t.affiliateId!) ?? t.affiliateId}</Td>
                <Td>{t._count}</Td>
                <Td className="tabular-nums">{formatCents(t._sum.revenueCents ?? 0)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Recent conversions" action={<Link href="/admin/conversions" className="text-xs font-medium text-indigo-600">View all</Link>} />
          <Table headers={['Order', 'Affiliate', 'Revenue', 'Status']}>
            {recentConversions.length === 0 && <EmptyRow cols={4} message="No conversions yet" />}
            {recentConversions.map(c => (
              <tr key={c.id}>
                <Td>{c.order.externalOrderId}</Td>
                <Td>{c.affiliate ? `${c.affiliate.firstName} ${c.affiliate.lastName}` : '—'}</Td>
                <Td className="tabular-nums">{formatCents(c.grossCents)}</Td>
                <Td>{c.status}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
