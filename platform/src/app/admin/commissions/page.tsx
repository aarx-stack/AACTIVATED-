import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { Card, Table, Td, EmptyRow, PageHeader, Badge, StatCard } from '@/components/ui'

export default async function CommissionsPage() {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId

  const [commissions, pending, approved, paid] = await Promise.all([
    db.commission.findMany({
      where: { organizationId: orgId },
      include: {
        affiliate: true,
        conversion: { include: { order: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.commission.aggregate({ where: { organizationId: orgId, status: 'PENDING' }, _sum: { amountCents: true, reversedCents: true } }),
    db.commission.aggregate({ where: { organizationId: orgId, status: 'APPROVED' }, _sum: { amountCents: true, reversedCents: true } }),
    db.commission.aggregate({ where: { organizationId: orgId, status: 'PAID' }, _sum: { amountCents: true, reversedCents: true } }),
  ])

  const net = (a: { _sum: { amountCents: number | null; reversedCents: number | null } }) =>
    (a._sum.amountCents ?? 0) - (a._sum.reversedCents ?? 0)

  return (
    <div>
      <PageHeader title="Commissions" subtitle="Personal commissions and team overrides" />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Pending" value={formatCents(net(pending))} />
        <StatCard label="Approved (payable)" value={formatCents(net(approved))} />
        <StatCard label="Paid" value={formatCents(net(paid))} />
      </div>
      <Card>
        <Table headers={['Affiliate', 'Order', 'Type', 'Amount', 'Reversed', 'Status', 'Date']}>
          {commissions.length === 0 && <EmptyRow cols={7} message="No commissions yet" />}
          {commissions.map(c => (
            <tr key={c.id}>
              <Td>{c.affiliate.firstName} {c.affiliate.lastName}</Td>
              <Td>{c.conversion.order.externalOrderId}</Td>
              <Td>{c.type === 'OVERRIDE' ? `Override L${c.overrideLevel}` : 'Personal'}</Td>
              <Td className="tabular-nums">{formatCents(c.amountCents)}</Td>
              <Td className="tabular-nums">{c.reversedCents > 0 ? formatCents(-c.reversedCents) : '—'}</Td>
              <Td><Badge status={c.status} /></Td>
              <Td className="text-xs text-zinc-400">{c.createdAt.toISOString().slice(0, 10)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
