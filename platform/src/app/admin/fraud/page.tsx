import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { Card, Table, Td, EmptyRow, PageHeader, Badge } from '@/components/ui'

export default async function FraudPage() {
  const session = (await requireAdmin())!
  const alerts = await db.fraudAlert.findMany({
    where: { organizationId: session.user.organizationId },
    include: { affiliate: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div>
      <PageHeader title="Fraud Monitoring" subtitle="Flagged conversions go to manual review — never auto-rejected" />
      <Card>
        <Table headers={['Time', 'Type', 'Affiliate', 'Risk score', 'Details', 'Status']}>
          {alerts.length === 0 && <EmptyRow cols={6} message="No fraud alerts" />}
          {alerts.map(a => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-xs text-zinc-400">{a.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</Td>
              <Td className="font-mono text-xs">{a.type}</Td>
              <Td>{a.affiliate ? `${a.affiliate.firstName} ${a.affiliate.lastName}` : '—'}</Td>
              <Td>
                <span className={a.riskScore >= 60 ? 'font-semibold text-red-600' : a.riskScore >= 40 ? 'font-semibold text-amber-600' : ''}>
                  {a.riskScore}
                </span>
              </Td>
              <Td className="text-xs">{a.details}</Td>
              <Td><Badge status={a.status === 'OPEN' ? 'PENDING' : 'APPROVED'} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
