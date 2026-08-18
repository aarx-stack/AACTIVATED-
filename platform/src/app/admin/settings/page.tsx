import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { getSetting, SETTING_KEYS } from '@/lib/settings'
import { saveSettings } from '../actions'
import { Card, CardHeader, PageHeader, inputClass, buttonClass } from '@/components/ui'

export default async function SettingsPage() {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId

  const [cookieWindow, priority, basis, autoApprove, payoutDay, maxLevels, levels] = await Promise.all([
    getSetting(orgId, SETTING_KEYS.cookieWindowDays),
    getSetting(orgId, SETTING_KEYS.attributionPriority),
    getSetting(orgId, SETTING_KEYS.commissionBasis),
    getSetting(orgId, SETTING_KEYS.autoApproveConversions),
    getSetting(orgId, SETTING_KEYS.payoutDay),
    getSetting(orgId, SETTING_KEYS.overrideMaxLevels),
    db.overrideLevel.findMany({ where: { organizationId: orgId }, orderBy: { level: 'asc' } }),
  ])
  const levelRate = (l: number) => {
    const row = levels.find(x => x.level === l)
    return row ? row.rateBps / 100 : ''
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Attribution, commissions, overrides, and payouts" />
      <form action={saveSettings} className="space-y-6">
        <Card>
          <CardHeader title="Attribution" />
          <div className="grid grid-cols-2 gap-4 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Cookie window</label>
              <select name="cookieWindow" defaultValue={cookieWindow} className={inputClass}>
                {[
                  ['1', '1 day'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days'],
                  ['60', '60 days'], ['90', '90 days'], ['-1', 'Lifetime'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Priority order (comma-separated)</label>
              <input name="attributionPriority" defaultValue={priority} className={inputClass} />
              <p className="mt-1 text-[10px] text-zinc-400">
                EXPLICIT_AFFILIATE_ID, CLICK_ID, PROMO_CODE, CUSTOMER_OWNER, COOKIE
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Commissions" />
          <div className="grid grid-cols-2 gap-4 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Commissionable revenue basis</label>
              <select name="commissionBasis" defaultValue={basis} className={inputClass}>
                <option value="SUBTOTAL_AFTER_DISCOUNT">Subtotal after discounts (recommended)</option>
                <option value="SUBTOTAL">Product subtotal</option>
                <option value="GROSS_TOTAL">Gross total</option>
                <option value="SUBTOTAL_EX_TAX">Total excluding tax</option>
                <option value="SUBTOTAL_EX_SHIPPING">Total excluding shipping</option>
                <option value="PROFIT">Profit / margin</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="autoApprove" defaultChecked={autoApprove === 'true'} />
                Auto-approve conversions (unless flagged for review)
              </label>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Team overrides" subtitle="Percentage of commissionable revenue paid to each upline level" />
          <div className="grid grid-cols-4 gap-4 px-5 py-4">
            {[1, 2, 3].map(l => (
              <div key={l}>
                <label className="mb-1 block text-xs font-medium">Level {l} %</label>
                <input name={`level${l}`} type="number" step="0.1" defaultValue={levelRate(l)} className={inputClass} />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs font-medium">Max levels</label>
              <input name="maxLevels" type="number" defaultValue={maxLevels} className={inputClass} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Payouts & security" />
          <div className="grid grid-cols-2 gap-4 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Payout day of week</label>
              <select name="payoutDay" defaultValue={payoutDay} className={inputClass}>
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Inbound webhook secret (leave blank to keep)</label>
              <input name="webhookSecret" type="password" placeholder="••••••••" className={inputClass} />
            </div>
          </div>
        </Card>

        <button className={buttonClass}>Save settings</button>
      </form>
    </div>
  )
}
