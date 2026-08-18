import { db } from './db'

export const SETTING_KEYS = {
  cookieWindowDays: 'attribution.cookie_window_days', // default 30; -1 = lifetime
  attributionPriority: 'attribution.priority', // comma-separated method order
  commissionBasis: 'commission.basis',
  autoApproveConversions: 'conversions.auto_approve', // 'true' | 'false'
  payoutDay: 'payouts.day_of_week', // 5 = Friday
  overrideMaxLevels: 'overrides.max_levels',
} as const

export const DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.cookieWindowDays]: '30',
  [SETTING_KEYS.attributionPriority]:
    'EXPLICIT_AFFILIATE_ID,CLICK_ID,PROMO_CODE,CUSTOMER_OWNER,COOKIE',
  [SETTING_KEYS.commissionBasis]: 'SUBTOTAL_AFTER_DISCOUNT',
  [SETTING_KEYS.autoApproveConversions]: 'false',
  [SETTING_KEYS.payoutDay]: '5',
  [SETTING_KEYS.overrideMaxLevels]: '3',
}

export async function getSetting(organizationId: string, key: string): Promise<string> {
  const row = await db.systemSetting.findUnique({
    where: { organizationId_key: { organizationId, key } },
  })
  return row?.value ?? DEFAULTS[key] ?? ''
}

export async function setSetting(organizationId: string, key: string, value: string) {
  await db.systemSetting.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, value },
    update: { value },
  })
}
