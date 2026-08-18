import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { createPromoCode, togglePromoCode } from '../actions'
import { Card, CardHeader, Table, Td, EmptyRow, PageHeader, Badge, inputClass, buttonClass, buttonSmallClass } from '@/components/ui'

export default async function PromoCodesPage() {
  const session = (await requireAdmin())!
  const codes = await db.promoCode.findMany({
    where: { organizationId: session.user.organizationId },
    include: { affiliate: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <PageHeader title="Promo Codes" subtitle="Codes attribute orders to their assigned affiliate" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Create promo code" />
          <form action={createPromoCode} className="space-y-3 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Code</label>
              <input name="code" required placeholder="SAVE20" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Assigned affiliate (ID or email)</label>
              <input name="affiliate" placeholder="AFF-XXXXXX" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Discount $</label>
                <input name="discountAmount" type="number" step="0.01" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Discount %</label>
                <input name="discountPercent" type="number" step="0.1" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Usage limit</label>
                <input name="usageLimit" type="number" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Min purchase $</label>
                <input name="minPurchase" type="number" step="0.01" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Starts</label>
                <input name="startsAt" type="date" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Ends</label>
                <input name="endsAt" type="date" className={inputClass} />
              </div>
            </div>
            <button className={`${buttonClass} w-full`}>Create</button>
          </form>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="All codes" />
          <Table headers={['Code', 'Affiliate', 'Discount', 'Usage', 'Status', 'Actions']}>
            {codes.length === 0 && <EmptyRow cols={6} message="No promo codes" />}
            {codes.map(p => (
              <tr key={p.id}>
                <Td className="font-mono font-medium">{p.code}</Td>
                <Td>{p.affiliate ? `${p.affiliate.firstName} ${p.affiliate.lastName}` : '—'}</Td>
                <Td>
                  {p.discountCents != null && formatCents(p.discountCents)}
                  {p.discountBps != null && `${p.discountBps / 100}%`}
                  {p.discountCents == null && p.discountBps == null && '—'}
                </Td>
                <Td>{p.usageCount}{p.usageLimit != null ? ` / ${p.usageLimit}` : ''}</Td>
                <Td><Badge status={p.isActive ? 'ACTIVE' : 'HELD'} /></Td>
                <Td>
                  <form action={togglePromoCode.bind(null, p.id)}>
                    <button className={buttonSmallClass}>{p.isActive ? 'Deactivate' : 'Activate'}</button>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
