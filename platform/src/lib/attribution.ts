import { db } from './db'
import { getSetting, SETTING_KEYS } from './settings'
import type { AttributionMethod } from '@/generated/prisma/enums'

export interface AttributionInput {
  organizationId: string
  affiliateCode?: string | null // explicit affiliate id/code from the order payload
  clickId?: string | null
  promoCode?: string | null
  customerId?: string | null // internal Customer.id, if already resolved
  orderPlacedAt: Date
}

export interface AttributionResult {
  affiliateId: string | null
  method: AttributionMethod
  clickRecordId: string | null
  offerId: string | null
  campaignId: string | null
}

const UNATTRIBUTED: AttributionResult = {
  affiliateId: null,
  method: 'UNATTRIBUTED',
  clickRecordId: null,
  offerId: null,
  campaignId: null,
}

async function findActiveAffiliate(organizationId: string, code: string) {
  const c = code.trim()
  if (!c) return null
  const aff = await db.affiliate.findFirst({
    where: {
      organizationId,
      status: 'ACTIVE',
      OR: [{ affiliateCode: c }, { referralCode: c }, { id: c }],
    },
  })
  return aff
}

/**
 * Attribution priority engine. Order is configurable per organization via
 * the `attribution.priority` setting; each resolver returns null when its
 * signal is absent or invalid so the next rule gets a chance.
 */
export async function resolveAttribution(input: AttributionInput): Promise<AttributionResult> {
  const order = (await getSetting(input.organizationId, SETTING_KEYS.attributionPriority))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  for (const method of order) {
    const result = await tryMethod(method, input)
    if (result) return result
  }
  return UNATTRIBUTED
}

async function tryMethod(method: string, input: AttributionInput): Promise<AttributionResult | null> {
  const { organizationId } = input
  switch (method) {
    case 'EXPLICIT_AFFILIATE_ID': {
      if (!input.affiliateCode) return null
      const aff = await findActiveAffiliate(organizationId, input.affiliateCode)
      if (!aff) return null
      return { affiliateId: aff.id, method: 'EXPLICIT_AFFILIATE_ID', clickRecordId: null, offerId: null, campaignId: null }
    }
    case 'CLICK_ID': {
      if (!input.clickId) return null
      const click = await db.click.findUnique({ where: { clickId: input.clickId } })
      if (!click || click.organizationId !== organizationId) return null
      const aff = await db.affiliate.findUnique({ where: { id: click.affiliateId } })
      if (!aff || aff.status !== 'ACTIVE') return null
      return {
        affiliateId: aff.id,
        method: 'CLICK_ID',
        clickRecordId: click.id,
        offerId: click.offerId,
        campaignId: click.campaignId,
      }
    }
    case 'PROMO_CODE': {
      if (!input.promoCode) return null
      const promo = await db.promoCode.findUnique({
        where: { organizationId_code: { organizationId, code: input.promoCode.trim().toUpperCase() } },
      })
      if (!promo || !promo.isActive || !promo.affiliateId) return null
      const now = input.orderPlacedAt
      if (promo.startsAt && now < promo.startsAt) return null
      if (promo.endsAt && now > promo.endsAt) return null
      if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) return null
      const aff = await db.affiliate.findUnique({ where: { id: promo.affiliateId } })
      if (!aff || aff.status !== 'ACTIVE') return null
      return { affiliateId: aff.id, method: 'PROMO_CODE', clickRecordId: null, offerId: null, campaignId: promo.campaignId }
    }
    case 'CUSTOMER_OWNER': {
      if (!input.customerId) return null
      const customer = await db.customer.findUnique({ where: { id: input.customerId } })
      if (!customer?.ownerAffiliateId) return null
      const aff = await db.affiliate.findUnique({ where: { id: customer.ownerAffiliateId } })
      if (!aff || aff.status !== 'ACTIVE') return null
      // recurring attribution must be enabled on the owning affiliate's plan
      if (aff.commissionPlanId) {
        const plan = await db.commissionPlan.findUnique({ where: { id: aff.commissionPlanId } })
        if (plan && !plan.recurring) return null
      }
      return { affiliateId: aff.id, method: 'CUSTOMER_OWNER', clickRecordId: null, offerId: null, campaignId: null }
    }
    case 'COOKIE': {
      // Cookie attribution = most recent click for this customer within the
      // configured window. Server-side we approximate via customer's click
      // history when a session/click id was persisted at click time.
      if (!input.customerId) return null
      const windowDays = Number(await getSetting(organizationId, SETTING_KEYS.cookieWindowDays))
      const customer = await db.customer.findUnique({ where: { id: input.customerId } })
      if (!customer?.ownerAffiliateId || !customer.ownerAttributedAt) return null
      if (windowDays >= 0) {
        const ageMs = input.orderPlacedAt.getTime() - customer.ownerAttributedAt.getTime()
        if (ageMs > windowDays * 86_400_000) return null
      }
      const aff = await db.affiliate.findUnique({ where: { id: customer.ownerAffiliateId } })
      if (!aff || aff.status !== 'ACTIVE') return null
      return { affiliateId: aff.id, method: 'COOKIE', clickRecordId: null, offerId: null, campaignId: null }
    }
    default:
      return null
  }
}
