import { db } from '@/lib/db'
import { requireAffiliate } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { Card, Table, Td, EmptyRow, PageHeader, Badge } from '@/components/ui'

export default async function PortalPayoutsPage() {
  const session = (await requireAffiliate())!
  const [payouts, ledger] = await Promise.all([
    db.payout.findMany({ where: { affiliateId: session.user.affiliateId! }, orderBy: { createdAt: 'desc' } }),
    db.commissionLedger.findMany({
      where: { affiliateId: session.user.affiliateId! },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  return (
    <div>
      <PageHeader title="Payouts" subtitle="Your payout batches and earnings ledger" />
      <Card>
        <Table headers={['Batch', 'Amount', 'Method', 'Status', 'Paid']}>
          {payouts.length === 0 && <EmptyRow cols={5} message="No payouts yet" />}
          {payouts.map(p => (
            <tr key={p.id}>
              <Td>{p.batchKey}</Td>
              <Td className="tabular-nums">{formatCents(p.amountCents)}</Td>
              <Td>{p.method ?? '—'}</Td>
              <Td><Badge status={p.status} /></Td>
              <Td className="text-xs text-zinc-400">{p.paidAt?.toISOString().slice(0, 10) ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card className="mt-6">
        <Table headers={['Date', 'Type', 'Amount', 'Description']}>
          {ledger.length === 0 && <EmptyRow cols={4} message="No transactions yet" />}
          {ledger.map(l => (
            <tr key={l.id}>
              <Td className="text-xs text-zinc-400">{l.createdAt.toISOString().slice(0, 10)}</Td>
              <Td className="text-xs">{l.type}</Td>
              <Td className={`tabular-nums ${l.amountCents < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {formatCents(l.amountCents)}
              </Td>
              <Td className="text-xs">{l.description ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
