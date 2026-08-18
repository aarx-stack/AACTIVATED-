import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { createAffiliate } from '../../actions'
import { Card, PageHeader, inputClass, buttonClass } from '@/components/ui'

export default async function NewAffiliatePage() {
  const session = (await requireAdmin())!
  const plans = await db.commissionPlan.findMany({
    where: { organizationId: session.user.organizationId, isActive: true },
  })

  async function submit(formData: FormData) {
    'use server'
    await createAffiliate(formData)
    redirect('/admin/affiliates')
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="New affiliate" subtitle="Create a rep, affiliate, or distributor" />
      <Card className="p-6">
        <form action={submit} className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">First name</label>
            <input name="firstName" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Last name</label>
            <input name="lastName" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Phone</label>
            <input name="phone" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Company</label>
            <input name="company" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <select name="type" className={inputClass}>
              <option value="AFFILIATE">Affiliate</option>
              <option value="REP">Rep</option>
              <option value="DISTRIBUTOR">Distributor</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <select name="status" className={inputClass}>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Commission plan</label>
            <select name="commissionPlanId" className={inputClass}>
              <option value="">None</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Upline (affiliate ID or email)</label>
            <input name="parent" placeholder="AFF-XXXXXX" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Payout method</label>
            <select name="payoutMethod" className={inputClass}>
              <option value="">—</option>
              <option value="ACH">ACH</option>
              <option value="PAYPAL">PayPal</option>
              <option value="VENMO">Venmo</option>
              <option value="ZELLE">Zelle</option>
              <option value="CHECK">Check</option>
              <option value="MANUAL">Manual</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium">Portal password (optional — creates a login)</label>
            <input name="password" type="password" className={inputClass} />
          </div>
          <div className="col-span-2">
            <button type="submit" className={buttonClass}>Create affiliate</button>
          </div>
        </form>
      </Card>
    </div>
  )
}
