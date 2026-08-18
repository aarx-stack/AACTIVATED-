import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { createOffer } from '../actions'
import { Card, CardHeader, Table, Td, EmptyRow, PageHeader, Badge, inputClass, buttonClass } from '@/components/ui'

export default async function OffersPage() {
  const session = (await requireAdmin())!
  const offers = await db.offer.findMany({
    where: { organizationId: session.user.organizationId },
    include: { advertiser: true, _count: { select: { clicks: true, conversions: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <PageHeader title="Offers" subtitle="Campaign offers with payout and attribution rules" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Create offer" />
          <form action={createOffer} className="space-y-3 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Name</label>
              <input name="name" required className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Landing page URL</label>
              <input name="landingPage" type="url" required placeholder="https://store.com/product" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Default payout %</label>
                <input name="payoutPercent" type="number" step="0.1" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Attribution window (days)</label>
                <input name="attributionWindow" type="number" defaultValue={30} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <select name="status" className={inputClass}>
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Description</label>
              <textarea name="description" rows={2} className={inputClass} />
            </div>
            <button className={`${buttonClass} w-full`}>Create offer</button>
          </form>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="All offers" />
          <Table headers={['Offer', 'Landing page', 'Payout', 'Window', 'Clicks', 'Conversions', 'Status']}>
            {offers.length === 0 && <EmptyRow cols={7} message="No offers yet" />}
            {offers.map(o => (
              <tr key={o.id}>
                <Td className="font-medium">{o.name}</Td>
                <Td className="max-w-48 truncate text-xs">{o.landingPageUrl}</Td>
                <Td>{o.defaultPayoutBps != null ? `${o.defaultPayoutBps / 100}%` : '—'}</Td>
                <Td>{o.attributionWindowDays}d</Td>
                <Td>{o._count.clicks}</Td>
                <Td>{o._count.conversions}</Td>
                <Td><Badge status={o.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
