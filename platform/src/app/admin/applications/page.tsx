import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { reviewApplication } from '../actions'
import { Card, Table, Td, EmptyRow, PageHeader, Badge, buttonSmallClass } from '@/components/ui'

export default async function ApplicationsPage() {
  const session = (await requireAdmin())!
  const applications = await db.affiliateApplication.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <PageHeader title="Applications" subtitle="Partner applications awaiting review" />
      <Card>
        <Table headers={['Applicant', 'Website', 'Strategy', 'Est. monthly sales', 'Submitted', 'Status', 'Actions']}>
          {applications.length === 0 && <EmptyRow cols={7} message="No applications" />}
          {applications.map(a => (
            <tr key={a.id}>
              <Td>
                <span className="font-medium">{a.name}</span>
                <p className="text-xs text-zinc-400">{a.email}</p>
              </Td>
              <Td className="max-w-40 truncate text-xs">{a.website ?? '—'}</Td>
              <Td className="max-w-56 truncate text-xs">{a.promotionStrategy ?? '—'}</Td>
              <Td>{a.estimatedSales ?? '—'}</Td>
              <Td className="text-xs text-zinc-400">{a.createdAt.toISOString().slice(0, 10)}</Td>
              <Td><Badge status={a.status} /></Td>
              <Td>
                {a.status === 'PENDING' && (
                  <div className="flex gap-1">
                    <form action={reviewApplication.bind(null, a.id, 'APPROVED')}>
                      <button className={buttonSmallClass}>Approve</button>
                    </form>
                    <form action={reviewApplication.bind(null, a.id, 'REJECTED')}>
                      <button className={buttonSmallClass}>Reject</button>
                    </form>
                    <form action={reviewApplication.bind(null, a.id, 'NEEDS_INFO')}>
                      <button className={buttonSmallClass}>Need info</button>
                    </form>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
