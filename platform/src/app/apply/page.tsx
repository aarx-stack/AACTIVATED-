import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { defaultOrganizationId } from '@/lib/webhook-ingest'
import { Card, inputClass, buttonClass } from '@/components/ui'

export default function ApplyPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  async function submit(formData: FormData) {
    'use server'
    const orgId = await defaultOrganizationId()
    if (!orgId) throw new Error('Platform not initialized')
    if (!formData.get('terms')) throw new Error('Terms must be accepted')
    await db.affiliateApplication.create({
      data: {
        organizationId: orgId,
        name: String(formData.get('name') ?? ''),
        email: String(formData.get('email') ?? '').toLowerCase(),
        phone: String(formData.get('phone') ?? '') || null,
        company: String(formData.get('company') ?? '') || null,
        website: String(formData.get('website') ?? '') || null,
        socialAccounts: String(formData.get('social') ?? '') || null,
        promotionStrategy: String(formData.get('strategy') ?? '') || null,
        estimatedSales: String(formData.get('estimatedSales') ?? '') || null,
        paymentInfo: String(formData.get('paymentInfo') ?? '') || null,
        termsAccepted: true,
      },
    })
    redirect('/apply?submitted=1')
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold">Become a partner</h1>
          <p className="mt-1 text-sm text-zinc-500">Apply to join our affiliate & rep program</p>
        </div>
        <ApplyBody searchParams={searchParams} submit={submit} />
      </div>
    </main>
  )
}

async function ApplyBody({
  searchParams,
  submit,
}: {
  searchParams: Promise<{ submitted?: string }>
  submit: (formData: FormData) => Promise<void>
}) {
  const sp = await searchParams
  if (sp.submitted) {
    return (
      <Card className="p-8 text-center">
        <p className="text-lg font-medium text-emerald-600">Application received!</p>
        <p className="mt-2 text-sm text-zinc-500">We&apos;ll review your application and email you when it&apos;s approved.</p>
      </Card>
    )
  }
  return (
    <Card className="p-6">
      <form action={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Full name</label>
            <input name="name" required className={inputClass} />
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
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Website</label>
          <input name="website" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Social accounts</label>
          <input name="social" placeholder="@instagram, @tiktok…" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">How will you promote us?</label>
          <textarea name="strategy" rows={3} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Estimated monthly sales</label>
            <select name="estimatedSales" className={inputClass}>
              <option>$0 - $1,000</option>
              <option>$1,000 - $5,000</option>
              <option>$5,000 - $25,000</option>
              <option>$25,000+</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Preferred payment</label>
            <select name="paymentInfo" className={inputClass}>
              <option>PayPal</option>
              <option>ACH</option>
              <option>Venmo</option>
              <option>Zelle</option>
              <option>Check</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="terms" required />
          I accept the program terms and conditions
        </label>
        <button className={`${buttonClass} w-full`}>Submit application</button>
      </form>
    </Card>
  )
}
