import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { setConversionStatus } from '../actions'
import { Card, Table, Td, EmptyRow, PageHeader, Badge, buttonSmallClass } from '@/components/ui'

export default async function ConversionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = (await requireAdmin())!
  const sp = await searchParams
  const status = sp.status?.toUpperCase()

  const conversions = await db.conversion.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(status ? { status: status as never } : {}),
    },
    include: { affiliate: true, order: { include: { customer: true } } },
    orderBy: { convertedAt: 'desc' },
    take: 100,
  })

  return (
    <div>
      <PageHeader title="Conversions" subtitle="Orders attributed to partners" />
      <div className="mb-4 flex gap-1">
        {['All', 'Pending', 'Approved', 'Rejected', 'Refunded'].map(s => (
          <a
            key={s}
            href={s === 'All' ? '/admin/conversions' : `/admin/conversions?status=${s.toLowerCase()}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-zinc-200 transition dark:ring-zinc-700 ${
              (s === 'All' && !status) || status === s.toUpperCase()
                ? 'bg-indigo-600 text-white ring-indigo-600'
                : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400'
            }`}
          >
            {s}
          </a>
        ))}
      </div>
      <Card>
        <Table headers={['Order', 'Affiliate', 'Customer', 'Attribution', 'Revenue', 'Commission', 'Overrides', 'Risk', 'Status', 'Actions']}>
          {conversions.length === 0 && <EmptyRow cols={10} message="No conversions found" />}
          {conversions.map(c => (
            <tr key={c.id}>
              <Td>
                <span className="font-medium">{c.order.externalOrderId}</span>
                <p className="text-xs text-zinc-400">{c.convertedAt.toISOString().slice(0, 16).replace('T', ' ')}</p>
              </Td>
              <Td>{c.affiliate ? `${c.affiliate.firstName} ${c.affiliate.lastName}` : '—'}</Td>
              <Td className="text-xs">{c.order.customer?.email ?? '—'}</Td>
              <Td className="text-xs">{c.attributionMethod}{c.promoCode ? ` (${c.promoCode})` : ''}</Td>
              <Td className="tabular-nums">{formatCents(c.revenueCents)}</Td>
              <Td className="tabular-nums">{formatCents(c.commissionCents)}</Td>
              <Td className="tabular-nums">{formatCents(c.overrideCents)}</Td>
              <Td>
                <span className={c.riskScore >= 40 ? 'font-semibold text-red-600' : 'text-zinc-400'}>{c.riskScore}</span>
              </Td>
              <Td><Badge status={c.status} /></Td>
              <Td>
                <div className="flex gap-1">
                  {c.status === 'PENDING' && (
                    <>
                      <form action={setConversionStatus.bind(null, c.id, 'APPROVED')}>
                        <button className={buttonSmallClass}>Approve</button>
                      </form>
                      <form action={setConversionStatus.bind(null, c.id, 'REJECTED')}>
                        <button className={buttonSmallClass}>Reject</button>
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
