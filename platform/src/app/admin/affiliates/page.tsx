import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { Card, Table, Td, EmptyRow, PageHeader, Badge, buttonClass } from '@/components/ui'

export default async function AffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = (await requireAdmin())!
  const sp = await searchParams
  const status = sp.status?.toUpperCase()

  const affiliates = await db.affiliate.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(status ? { status: status as never } : {}),
    },
    include: { parent: { select: { firstName: true, lastName: true } }, commissionPlan: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return (
    <div>
      <PageHeader
        title="Affiliates"
        subtitle={`${affiliates.length} partners`}
        action={<Link href="/admin/affiliates/new" className={buttonClass}>New affiliate</Link>}
      />
      <div className="mb-4 flex gap-1">
        {['All', 'Active', 'Pending', 'Suspended'].map(s => (
          <Link
            key={s}
            href={s === 'All' ? '/admin/affiliates' : `/admin/affiliates?status=${s.toLowerCase()}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-zinc-200 transition dark:ring-zinc-700 ${
              (s === 'All' && !status) || status === s.toUpperCase()
                ? 'bg-indigo-600 text-white ring-indigo-600'
                : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>
      <Card>
        <Table headers={['Name', 'ID', 'Referral Code', 'Type', 'Upline', 'Plan', 'Status', 'Joined']}>
          {affiliates.length === 0 && <EmptyRow cols={8} message="No affiliates found" />}
          {affiliates.map(a => (
            <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <Td>
                <Link href={`/admin/affiliates/${a.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                  {a.firstName} {a.lastName}
                </Link>
                <p className="text-xs text-zinc-400">{a.email}</p>
              </Td>
              <Td className="font-mono text-xs">{a.affiliateCode}</Td>
              <Td className="font-mono text-xs">{a.referralCode}</Td>
              <Td>{a.type}</Td>
              <Td>{a.parent ? `${a.parent.firstName} ${a.parent.lastName}` : '—'}</Td>
              <Td>{a.commissionPlan?.name ?? '—'}</Td>
              <Td><Badge status={a.status} /></Td>
              <Td className="text-xs text-zinc-400">{a.joinedAt.toISOString().slice(0, 10)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
