import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { runPayoutBatch, setPayoutStatus } from '../actions'
import { Card, Table, Td, EmptyRow, PageHeader, Badge, StatCard, buttonClass, buttonSecondaryClass, buttonSmallClass } from '@/components/ui'

export default async function PayoutsPage() {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId

  const [payouts, eligibleAgg, pendingAgg, paidAgg] = await Promise.all([
    db.payout.findMany({
      where: { organizationId: orgId },
      include: { affiliate: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.commission.aggregate({
      where: { organizationId: orgId, status: 'APPROVED', payoutItems: { none: {} } },
      _sum: { amountCents: true, reversedCents: true },
    }),
    db.payout.aggregate({ where: { organizationId: orgId, status: 'PENDING' }, _sum: { amountCents: true } }),
    db.payout.aggregate({ where: { organizationId: orgId, status: 'PAID' }, _sum: { amountCents: true } }),
  ])

  const eligible = (eligibleAgg._sum.amountCents ?? 0) - (eligibleAgg._sum.reversedCents ?? 0)

  return (
    <div>
      <PageHeader
        title="Payouts"
        subtitle="Weekly payout batches — approved commissions pay out the following Friday"
        action={
          <div className="flex gap-2">
            <a href="/admin/payouts/export" className={buttonSecondaryClass}>Export CSV</a>
            <form action={runPayoutBatch}>
              <button className={buttonClass}>Generate batch</button>
            </form>
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Eligible (approved, unbatched)" value={formatCents(eligible)} />
        <StatCard label="Pending payouts" value={formatCents(pendingAgg._sum.amountCents ?? 0)} />
        <StatCard label="Paid out" value={formatCents(paidAgg._sum.amountCents ?? 0)} />
      </div>
      <Card>
        <Table headers={['Affiliate', 'Batch', 'Amount', 'Items', 'Method', 'Status', 'Actions']}>
          {payouts.length === 0 && <EmptyRow cols={7} message="No payouts yet — generate a batch when commissions are approved" />}
          {payouts.map(p => (
            <tr key={p.id}>
              <Td>{p.affiliate.firstName} {p.affiliate.lastName}</Td>
              <Td>{p.batchKey}</Td>
              <Td className="tabular-nums">{formatCents(p.amountCents)}</Td>
              <Td>{p.items.length}</Td>
              <Td>{p.method ?? '—'}</Td>
              <Td><Badge status={p.status} /></Td>
              <Td>
                <div className="flex gap-1">
                  {(p.status === 'PENDING' || p.status === 'PROCESSING') && (
                    <>
                      <form action={setPayoutStatus.bind(null, p.id, 'PAID')}>
                        <button className={buttonSmallClass}>Mark paid</button>
                      </form>
                      <form action={setPayoutStatus.bind(null, p.id, 'FAILED')}>
                        <button className={buttonSmallClass}>Failed</button>
                      </form>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
