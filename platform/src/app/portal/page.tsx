import { db } from '@/lib/db'
import { requireAffiliate } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { affiliateBalances } from '@/lib/payouts'
import { Card, CardHeader, StatCard, Table, Td, EmptyRow, Badge } from '@/components/ui'
import { CopyButton } from '@/components/copy-button'

export default async function PortalDashboard() {
  const session = (await requireAffiliate())!
  const affiliateId = session.user.affiliateId!
  const orgId = session.user.organizationId

  const affiliate = (await db.affiliate.findUnique({
    where: { id: affiliateId },
    include: { promoCodes: { where: { isActive: true } }, children: { select: { id: true } } },
  }))!

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const [balances, clicks, convAgg, monthAgg, recentConversions, payouts, teamRevenue] = await Promise.all([
    affiliateBalances(orgId, affiliateId),
    db.click.count({ where: { affiliateId } }),
    db.conversion.aggregate({
      where: { affiliateId, status: { notIn: ['REJECTED'] } },
      _count: true,
      _sum: { revenueCents: true },
    }),
    db.conversion.aggregate({
      where: { affiliateId, convertedAt: { gte: monthStart }, status: { notIn: ['REJECTED'] } },
      _sum: { revenueCents: true },
    }),
    db.conversion.findMany({
      where: { affiliateId },
      orderBy: { convertedAt: 'desc' },
      take: 8,
      include: { order: true },
    }),
    db.payout.findMany({ where: { affiliateId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    affiliate.children.length > 0
      ? db.conversion.aggregate({
          where: { affiliateId: { in: affiliate.children.map(c => c.id) }, status: { notIn: ['REJECTED'] } },
          _sum: { revenueCents: true },
        })
      : Promise.resolve(null),
  ])

  const trackingUrl = `${process.env.APP_URL}/r/${affiliate.referralCode}`
  const conversions = convAgg._count
  const cvr = clicks > 0 ? ((conversions / clicks) * 100).toFixed(1) : '0.0'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Welcome back, {affiliate.firstName}</h1>
        <p className="text-sm text-zinc-500">{affiliate.affiliateCode} · {affiliate.type}</p>
      </div>

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Your tracking link</p>
            <p className="mt-1 truncate font-mono text-sm text-indigo-600">{trackingUrl}</p>
          </div>
          <CopyButton text={trackingUrl} label="Copy link" />
        </div>
        <div className="mt-4 flex flex-wrap gap-6 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500">Referral code</p>
            <p className="font-mono">{affiliate.referralCode}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Promo codes</p>
            <p className="font-mono">{affiliate.promoCodes.map(p => p.code).join(', ') || '—'}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Available balance" value={formatCents(balances.balanceCents)} />
        <StatCard label="Pending commission" value={formatCents(balances.pendingCents)} />
        <StatCard label="Approved commission" value={formatCents(balances.approvedCents)} />
        <StatCard label="Paid out" value={formatCents(balances.paidCents)} />
        <StatCard label="Sales this month" value={formatCents(monthAgg._sum.revenueCents ?? 0)} />
        <StatCard label="Clicks" value={String(clicks)} />
        <StatCard label="Conversions" value={String(conversions)} sub={`${cvr}% conversion rate`} />
        <StatCard
          label="Team revenue"
          value={formatCents(teamRevenue?._sum.revenueCents ?? 0)}
          sub={`${affiliate.children.length} direct reports`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent orders" />
          <Table headers={['Order', 'Revenue', 'Commission', 'Status']}>
            {recentConversions.length === 0 && <EmptyRow cols={4} message="No sales yet — share your link!" />}
            {recentConversions.map(c => (
              <tr key={c.id}>
                <Td>{c.order.externalOrderId}</Td>
                <Td className="tabular-nums">{formatCents(c.revenueCents)}</Td>
                <Td className="tabular-nums">{formatCents(c.commissionCents)}</Td>
                <Td><Badge status={c.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Payout history" />
          <Table headers={['Batch', 'Amount', 'Method', 'Status']}>
            {payouts.length === 0 && <EmptyRow cols={4} message="No payouts yet" />}
            {payouts.map(p => (
              <tr key={p.id}>
                <Td>{p.batchKey}</Td>
                <Td className="tabular-nums">{formatCents(p.amountCents)}</Td>
                <Td>{p.method ?? '—'}</Td>
                <Td><Badge status={p.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
