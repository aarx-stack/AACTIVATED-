import { db } from '@/lib/db'
import { requireAffiliate } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { Card, CardHeader, StatCard, Table, Td, EmptyRow, PageHeader } from '@/components/ui'

export default async function PortalTeamPage() {
  const session = (await requireAffiliate())!
  const affiliateId = session.user.affiliateId!

  // collect downline by level (up to 3)
  const level1 = await db.affiliate.findMany({ where: { parentId: affiliateId } })
  const level2 = level1.length
    ? await db.affiliate.findMany({ where: { parentId: { in: level1.map(a => a.id) } } })
    : []
  const level3 = level2.length
    ? await db.affiliate.findMany({ where: { parentId: { in: level2.map(a => a.id) } } })
    : []

  const allIds = [...level1, ...level2, ...level3].map(a => a.id)
  const revenue = allIds.length
    ? await db.conversion.groupBy({
        by: ['affiliateId'],
        where: { affiliateId: { in: allIds }, status: { notIn: ['REJECTED'] } },
        _sum: { revenueCents: true },
        _count: true,
      })
    : []
  const revMap = new Map(revenue.map(r => [r.affiliateId!, r]))

  const overrides = await db.commission.aggregate({
    where: { affiliateId, type: 'OVERRIDE' },
    _sum: { amountCents: true, reversedCents: true },
  })
  const teamRevenueCents = revenue.reduce((s, r) => s + (r._sum.revenueCents ?? 0), 0)

  const renderLevel = (label: string, members: typeof level1) => (
    <Card className="mt-6">
      <CardHeader title={label} subtitle={`${members.length} members`} />
      <Table headers={['Name', 'ID', 'Status', 'Orders', 'Revenue']}>
        {members.length === 0 && <EmptyRow cols={5} message="No members at this level" />}
        {members.map(m => {
          const r = revMap.get(m.id)
          return (
            <tr key={m.id}>
              <Td>{m.firstName} {m.lastName}</Td>
              <Td className="font-mono text-xs">{m.affiliateCode}</Td>
              <Td>{m.status}</Td>
              <Td>{r?._count ?? 0}</Td>
              <Td className="tabular-nums">{formatCents(r?._sum.revenueCents ?? 0)}</Td>
            </tr>
          )
        })}
      </Table>
    </Card>
  )

  return (
    <div>
      <PageHeader title="My Team" subtitle="Your downline and override earnings" />
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Team members" value={String(allIds.length)} />
        <StatCard label="Team revenue" value={formatCents(teamRevenueCents)} />
        <StatCard
          label="Override earnings"
          value={formatCents((overrides._sum.amountCents ?? 0) - (overrides._sum.reversedCents ?? 0))}
        />
      </div>
      {renderLevel('Level 1 — direct', level1)}
      {renderLevel('Level 2', level2)}
      {renderLevel('Level 3', level3)}
    </div>
  )
}
