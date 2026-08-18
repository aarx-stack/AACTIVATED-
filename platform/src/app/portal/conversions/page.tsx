import { db } from '@/lib/db'
import { requireAffiliate } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { Card, Table, Td, EmptyRow, PageHeader, Badge } from '@/components/ui'

export default async function PortalConversionsPage() {
  const session = (await requireAffiliate())!
  const conversions = await db.conversion.findMany({
    where: { affiliateId: session.user.affiliateId! },
    include: { order: true },
    orderBy: { convertedAt: 'desc' },
    take: 100,
  })

  return (
    <div>
      <PageHeader title="My Sales" subtitle="Orders attributed to you" />
      <Card>
        <Table headers={['Order', 'Date', 'Revenue', 'Commission', 'Attribution', 'Status']}>
          {conversions.length === 0 && <EmptyRow cols={6} message="No sales yet" />}
          {conversions.map(c => (
            <tr key={c.id}>
              <Td>{c.order.externalOrderId}</Td>
              <Td className="text-xs text-zinc-400">{c.convertedAt.toISOString().slice(0, 10)}</Td>
              <Td className="tabular-nums">{formatCents(c.revenueCents)}</Td>
              <Td className="tabular-nums">{formatCents(c.commissionCents)}</Td>
              <Td className="text-xs">{c.attributionMethod}</Td>
              <Td><Badge status={c.status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
