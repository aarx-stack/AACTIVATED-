import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { affiliateBalances } from '@/lib/payouts'
import { updateAffiliateStatus, assignUpline } from '../../actions'
import { Card, CardHeader, StatCard, Table, Td, EmptyRow, PageHeader, Badge, buttonSmallClass, inputClass } from '@/components/ui'
import { CopyButton } from '@/components/copy-button'

export default async function AffiliateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId
  const { id } = await params

  const affiliate = await db.affiliate.findFirst({
    where: { id, organizationId: orgId },
    include: {
      parent: true,
      children: true,
      commissionPlan: true,
      promoCodes: true,
      trackingLinks: true,
    },
  })
  if (!affiliate) notFound()

  const [balances, conversions, commissions, payouts, ledger, clicks] = await Promise.all([
    affiliateBalances(orgId, affiliate.id),
    db.conversion.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { convertedAt: 'desc' },
      take: 10,
      include: { order: true },
    }),
    db.commission.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { conversion: { include: { order: true } } },
    }),
    db.payout.findMany({ where: { affiliateId: affiliate.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.commissionLedger.findMany({ where: { affiliateId: affiliate.id }, orderBy: { createdAt: 'desc' }, take: 15 }),
    db.click.count({ where: { affiliateId: affiliate.id } }),
  ])

  const trackingUrl = `${process.env.APP_URL}/r/${affiliate.referralCode}`

  return (
    <div>
      <PageHeader
        title={`${affiliate.firstName} ${affiliate.lastName}`}
        subtitle={`${affiliate.affiliateCode} · ${affiliate.email} · ${affiliate.type}`}
        action={
          <div className="flex items-center gap-2">
            <Badge status={affiliate.status} />
            {affiliate.status !== 'ACTIVE' && (
              <form action={updateAffiliateStatus.bind(null, affiliate.id, 'ACTIVE')}>
                <button className={buttonSmallClass}>Approve / Activate</button>
              </form>
            )}
            {affiliate.status === 'ACTIVE' && (
              <form action={updateAffiliateStatus.bind(null, affiliate.id, 'SUSPENDED')}>
                <button className={buttonSmallClass}>Suspend</button>
              </form>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Pending" value={formatCents(balances.pendingCents)} />
        <StatCard label="Approved (payable)" value={formatCents(balances.approvedCents)} />
        <StatCard label="Paid out" value={formatCents(balances.paidCents)} />
        <StatCard label="Clicks" value={String(clicks)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tracking" subtitle="Links and codes for this affiliate" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">Tracking URL</p>
                <p className="truncate font-mono text-xs">{trackingUrl}</p>
              </div>
              <CopyButton text={trackingUrl} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-zinc-500">Referral code</p>
                <p className="font-mono text-xs">{affiliate.referralCode}</p>
              </div>
              <CopyButton text={affiliate.referralCode} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Promo codes</p>
              <p className="font-mono text-xs">
                {affiliate.promoCodes.length > 0 ? affiliate.promoCodes.map(p => p.code).join(', ') : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Commission plan</p>
              <p className="text-xs">{affiliate.commissionPlan?.name ?? 'None assigned'}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Team" subtitle="Upline and direct downline" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <div>
              <p className="text-xs text-zinc-500">Upline</p>
              {affiliate.parent ? (
                <Link href={`/admin/affiliates/${affiliate.parent.id}`} className="text-indigo-600">
                  {affiliate.parent.firstName} {affiliate.parent.lastName} ({affiliate.parent.affiliateCode})
                </Link>
              ) : (
                <p className="text-zinc-400">None</p>
              )}
            </div>
            <form
              action={async (formData: FormData) => {
                'use server'
                await assignUpline(affiliate.id, String(formData.get('parent') ?? ''))
              }}
              className="flex gap-2"
            >
              <input name="parent" placeholder="Upline affiliate ID or email" className={inputClass} />
              <button className={buttonSmallClass}>Set</button>
            </form>
            <div>
              <p className="mb-1 text-xs text-zinc-500">Direct downline ({affiliate.children.length})</p>
              {affiliate.children.map(c => (
                <Link key={c.id} href={`/admin/affiliates/${c.id}`} className="mr-3 text-xs text-indigo-600">
                  {c.firstName} {c.lastName}
                </Link>
              ))}
              {affiliate.children.length === 0 && <p className="text-xs text-zinc-400">No downline members</p>}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent conversions" />
          <Table headers={['Order', 'Revenue', 'Commission', 'Status']}>
            {conversions.length === 0 && <EmptyRow cols={4} message="No conversions" />}
            {conversions.map(c => (
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
          <CardHeader title="Recent commissions" />
          <Table headers={['Order', 'Type', 'Amount', 'Status']}>
            {commissions.length === 0 && <EmptyRow cols={4} message="No commissions" />}
            {commissions.map(c => (
              <tr key={c.id}>
                <Td>{c.conversion.order.externalOrderId}</Td>
                <Td>{c.type === 'OVERRIDE' ? `Override L${c.overrideLevel}` : 'Personal'}</Td>
                <Td className="tabular-nums">{formatCents(c.amountCents - c.reversedCents)}</Td>
                <Td><Badge status={c.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Payout history" />
          <Table headers={['Batch', 'Amount', 'Method', 'Status']}>
            {payouts.length === 0 && <EmptyRow cols={4} message="No payouts" />}
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
        <Card>
          <CardHeader title="Ledger" subtitle="Immutable transaction history" />
          <Table headers={['Type', 'Amount', 'Description', 'Date']}>
            {ledger.length === 0 && <EmptyRow cols={4} message="No ledger entries" />}
            {ledger.map(l => (
              <tr key={l.id}>
                <Td className="text-xs">{l.type}</Td>
                <Td className={`tabular-nums ${l.amountCents < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCents(l.amountCents)}
                </Td>
                <Td className="text-xs">{l.description ?? '—'}</Td>
                <Td className="text-xs text-zinc-400">{l.createdAt.toISOString().slice(0, 10)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
