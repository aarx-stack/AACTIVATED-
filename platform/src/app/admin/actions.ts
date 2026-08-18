'use server'

// Admin server actions. RBAC is enforced server-side in every action.
import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { newAffiliateCode, newApiKey, newReferralCode, randomToken } from '@/lib/ids'
import { hashApiKey, encryptSecret } from '@/lib/crypto'
import { generatePayoutBatch, updatePayoutStatus } from '@/lib/payouts'
import { attemptDelivery, queueOutboundWebhook } from '@/lib/webhooks-out'
import { setSetting } from '@/lib/settings'
import { toCents } from '@/lib/money'

async function adminCtx() {
  const session = await requireAdmin()
  if (!session) throw new Error('Unauthorized')
  return { orgId: session.user.organizationId, userId: session.user.id }
}

// ── Affiliates ──────────────────────────────────────────────────────────────

export async function createAffiliate(formData: FormData) {
  const { orgId, userId } = await adminCtx()
  const parentCode = String(formData.get('parent') ?? '').trim()
  let parentId: string | null = null
  if (parentCode) {
    const parent = await db.affiliate.findFirst({
      where: { organizationId: orgId, OR: [{ affiliateCode: parentCode }, { referralCode: parentCode }, { email: parentCode }] },
    })
    parentId = parent?.id ?? null
  }
  const planId = String(formData.get('commissionPlanId') ?? '') || null
  const affiliate = await db.affiliate.create({
    data: {
      organizationId: orgId,
      affiliateCode: newAffiliateCode(),
      referralCode: newReferralCode(),
      firstName: String(formData.get('firstName') ?? ''),
      lastName: String(formData.get('lastName') ?? ''),
      email: String(formData.get('email') ?? '').toLowerCase(),
      phone: String(formData.get('phone') ?? '') || null,
      company: String(formData.get('company') ?? '') || null,
      type: (String(formData.get('type') ?? 'AFFILIATE') as 'AFFILIATE' | 'REP' | 'DISTRIBUTOR'),
      status: (String(formData.get('status') ?? 'ACTIVE') as 'PENDING' | 'ACTIVE'),
      parentId,
      commissionPlanId: planId,
      payoutMethod: String(formData.get('payoutMethod') ?? '') || null,
    },
  })

  // optional portal login
  const password = String(formData.get('password') ?? '')
  if (password) {
    const user = await db.user.create({
      data: {
        organizationId: orgId,
        email: affiliate.email,
        name: `${affiliate.firstName} ${affiliate.lastName}`,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'AFFILIATE',
      },
    })
    await db.affiliate.update({ where: { id: affiliate.id }, data: { userId: user.id } })
  }

  await logAudit({ organizationId: orgId, userId, action: 'affiliate.created', targetType: 'Affiliate', targetId: affiliate.id, newValue: { email: affiliate.email } })
  await queueOutboundWebhook(orgId, 'affiliate.created', { affiliate_id: affiliate.affiliateCode, email: affiliate.email })
  revalidatePath('/admin/affiliates')
}

export async function updateAffiliateStatus(affiliateId: string, status: 'ACTIVE' | 'SUSPENDED' | 'REJECTED' | 'PENDING') {
  const { orgId, userId } = await adminCtx()
  const before = await db.affiliate.findFirst({ where: { id: affiliateId, organizationId: orgId } })
  if (!before) throw new Error('Not found')
  await db.affiliate.update({ where: { id: affiliateId }, data: { status } })
  await logAudit({
    organizationId: orgId, userId, action: 'affiliate.status_changed',
    targetType: 'Affiliate', targetId: affiliateId,
    oldValue: { status: before.status }, newValue: { status },
  })
  if (status === 'ACTIVE' && before.status === 'PENDING') {
    await queueOutboundWebhook(orgId, 'affiliate.approved', { affiliate_id: before.affiliateCode })
  }
  revalidatePath('/admin/affiliates')
  revalidatePath(`/admin/affiliates/${affiliateId}`)
}

export async function assignUpline(affiliateId: string, parentCode: string) {
  const { orgId, userId } = await adminCtx()
  const affiliate = await db.affiliate.findFirst({ where: { id: affiliateId, organizationId: orgId } })
  if (!affiliate) throw new Error('Not found')
  if (!parentCode.trim()) {
    await db.affiliate.update({ where: { id: affiliateId }, data: { parentId: null } })
    revalidatePath(`/admin/affiliates/${affiliateId}`)
    return
  }
  const parent = await db.affiliate.findFirst({
    where: { organizationId: orgId, OR: [{ affiliateCode: parentCode.trim() }, { email: parentCode.trim() }] },
  })
  if (!parent || parent.id === affiliateId) throw new Error('Invalid upline')
  // prevent circular relationships: walk up from the proposed parent
  let cursor: string | null = parent.id
  for (let i = 0; i < 50 && cursor; i++) {
    if (cursor === affiliateId) throw new Error('Circular team relationship')
    const row: { parentId: string | null } | null = await db.affiliate.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    })
    cursor = row?.parentId ?? null
  }
  await db.affiliate.update({ where: { id: affiliateId }, data: { parentId: parent.id } })
  await logAudit({ organizationId: orgId, userId, action: 'affiliate.upline_changed', targetType: 'Affiliate', targetId: affiliateId, newValue: { parentId: parent.id } })
  revalidatePath(`/admin/affiliates/${affiliateId}`)
}

// ── Conversions ─────────────────────────────────────────────────────────────

export async function setConversionStatus(conversionId: string, status: 'APPROVED' | 'REJECTED' | 'PENDING') {
  const { orgId, userId } = await adminCtx()
  const conv = await db.conversion.findFirst({
    where: { id: conversionId, organizationId: orgId },
    include: { commissions: true },
  })
  if (!conv) throw new Error('Not found')

  await db.$transaction(async tx => {
    await tx.conversion.update({ where: { id: conversionId }, data: { status } })
    for (const c of conv.commissions) {
      if (c.status === 'PAID' || c.status === 'REVERSED') continue
      if (status === 'APPROVED') {
        await tx.commission.update({ where: { id: c.id }, data: { status: 'APPROVED', approvedAt: new Date() } })
      } else if (status === 'REJECTED') {
        // balancing ledger entry, never delete history
        const remaining = c.amountCents - c.reversedCents
        if (remaining > 0) {
          await tx.commission.update({ where: { id: c.id }, data: { status: 'REVERSED', reversedCents: c.amountCents } })
          await tx.commissionLedger.create({
            data: {
              organizationId: orgId,
              affiliateId: c.affiliateId,
              type: 'COMMISSION_ADJUSTMENT',
              amountCents: -remaining,
              commissionId: c.id,
              conversionId: conv.id,
              description: 'Conversion rejected by admin',
            },
          })
        }
      } else {
        await tx.commission.update({ where: { id: c.id }, data: { status: 'PENDING', approvedAt: null } })
      }
    }
  })

  await logAudit({ organizationId: orgId, userId, action: `conversion.${status.toLowerCase()}`, targetType: 'Conversion', targetId: conversionId })
  await queueOutboundWebhook(orgId, status === 'APPROVED' ? 'conversion.approved' : 'conversion.rejected', { conversion_id: conversionId })
  revalidatePath('/admin/conversions')
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export async function runPayoutBatch() {
  const { orgId, userId } = await adminCtx()
  const result = await generatePayoutBatch({ organizationId: orgId })
  await logAudit({ organizationId: orgId, userId, action: 'payout.batch_generated', newValue: result })
  revalidatePath('/admin/payouts')
}

export async function setPayoutStatus(payoutId: string, status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'HELD') {
  const { orgId, userId } = await adminCtx()
  const payout = await db.payout.findFirst({ where: { id: payoutId, organizationId: orgId } })
  if (!payout) throw new Error('Not found')
  await updatePayoutStatus(payoutId, status)
  await logAudit({ organizationId: orgId, userId, action: 'payout.status_changed', targetType: 'Payout', targetId: payoutId, oldValue: { status: payout.status }, newValue: { status } })
  revalidatePath('/admin/payouts')
}

// ── Promo codes ─────────────────────────────────────────────────────────────

export async function createPromoCode(formData: FormData) {
  const { orgId, userId } = await adminCtx()
  const affiliateCode = String(formData.get('affiliate') ?? '').trim()
  let affiliateId: string | null = null
  if (affiliateCode) {
    const a = await db.affiliate.findFirst({
      where: { organizationId: orgId, OR: [{ affiliateCode }, { email: affiliateCode }, { referralCode: affiliateCode }] },
    })
    affiliateId = a?.id ?? null
  }
  const discountAmount = String(formData.get('discountAmount') ?? '')
  const discountPercent = String(formData.get('discountPercent') ?? '')
  const promo = await db.promoCode.create({
    data: {
      organizationId: orgId,
      code: String(formData.get('code') ?? '').trim().toUpperCase(),
      affiliateId,
      discountCents: discountAmount ? toCents(discountAmount) : null,
      discountBps: discountPercent ? Math.round(Number(discountPercent) * 100) : null,
      usageLimit: formData.get('usageLimit') ? Number(formData.get('usageLimit')) : null,
      minPurchaseCents: formData.get('minPurchase') ? toCents(String(formData.get('minPurchase'))) : null,
      startsAt: formData.get('startsAt') ? new Date(String(formData.get('startsAt'))) : null,
      endsAt: formData.get('endsAt') ? new Date(String(formData.get('endsAt'))) : null,
    },
  })
  await logAudit({ organizationId: orgId, userId, action: 'promo_code.created', targetType: 'PromoCode', targetId: promo.id, newValue: { code: promo.code } })
  revalidatePath('/admin/promo-codes')
}

export async function togglePromoCode(id: string) {
  const { orgId } = await adminCtx()
  const promo = await db.promoCode.findFirst({ where: { id, organizationId: orgId } })
  if (!promo) throw new Error('Not found')
  await db.promoCode.update({ where: { id }, data: { isActive: !promo.isActive } })
  revalidatePath('/admin/promo-codes')
}

// ── Offers ──────────────────────────────────────────────────────────────────

export async function createOffer(formData: FormData) {
  const { orgId, userId } = await adminCtx()
  const payoutPercent = String(formData.get('payoutPercent') ?? '')
  const offer = await db.offer.create({
    data: {
      organizationId: orgId,
      name: String(formData.get('name') ?? ''),
      landingPageUrl: String(formData.get('landingPage') ?? ''),
      description: String(formData.get('description') ?? '') || null,
      status: (String(formData.get('status') ?? 'ACTIVE') as 'DRAFT' | 'ACTIVE'),
      attributionWindowDays: Number(formData.get('attributionWindow') ?? 30),
      defaultPayoutBps: payoutPercent ? Math.round(Number(payoutPercent) * 100) : null,
    },
  })
  await logAudit({ organizationId: orgId, userId, action: 'offer.created', targetType: 'Offer', targetId: offer.id, newValue: { name: offer.name } })
  revalidatePath('/admin/offers')
}

// ── API keys ────────────────────────────────────────────────────────────────

export async function createApiKeyAction(formData: FormData): Promise<void> {
  const { orgId, userId } = await adminCtx()
  const mode = String(formData.get('mode') ?? 'LIVE') as 'LIVE' | 'TEST'
  const key = newApiKey(mode)
  const permissions = formData.getAll('permissions').map(String).join(',') || 'conversion:write'
  const record = await db.apiKey.create({
    data: {
      organizationId: orgId,
      name: String(formData.get('name') ?? 'API Key'),
      prefix: key.slice(0, 12),
      keyHash: hashApiKey(key),
      permissions,
      mode,
    },
  })
  await logAudit({ organizationId: orgId, userId, action: 'api_key.created', targetType: 'ApiKey', targetId: record.id, newValue: { name: record.name, permissions } })
  // secret is displayed exactly once via a short-lived setting slot
  await setSetting(orgId, `apikey.reveal.${record.id}`, key)
  revalidatePath('/admin/api-keys')
}

export async function dismissApiKeyReveal(keyId: string) {
  const { orgId } = await adminCtx()
  await db.systemSetting.deleteMany({ where: { organizationId: orgId, key: `apikey.reveal.${keyId}` } })
  revalidatePath('/admin/api-keys')
}

export async function revokeApiKey(keyId: string) {
  const { orgId, userId } = await adminCtx()
  const key = await db.apiKey.findFirst({ where: { id: keyId, organizationId: orgId } })
  if (!key) throw new Error('Not found')
  await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } })
  await logAudit({ organizationId: orgId, userId, action: 'api_key.revoked', targetType: 'ApiKey', targetId: keyId })
  revalidatePath('/admin/api-keys')
}

// ── Webhook endpoints ───────────────────────────────────────────────────────

export async function createWebhookEndpoint(formData: FormData) {
  const { orgId, userId } = await adminCtx()
  const secret = `whsec_${randomToken(32)}`
  const endpoint = await db.webhookEndpoint.create({
    data: {
      organizationId: orgId,
      url: String(formData.get('url') ?? ''),
      description: String(formData.get('description') ?? '') || null,
      secret: encryptSecret(secret),
      events: String(formData.get('events') ?? '*'),
    },
  })
  await logAudit({ organizationId: orgId, userId, action: 'webhook_endpoint.created', targetType: 'WebhookEndpoint', targetId: endpoint.id, newValue: { url: endpoint.url } })
  await setSetting(orgId, `whsecret.reveal.${endpoint.id}`, secret)
  revalidatePath('/admin/webhooks')
}

export async function dismissWebhookSecretReveal(endpointId: string) {
  const { orgId } = await adminCtx()
  await db.systemSetting.deleteMany({ where: { organizationId: orgId, key: `whsecret.reveal.${endpointId}` } })
  revalidatePath('/admin/webhooks')
}

export async function retryWebhookDelivery(deliveryId: string) {
  await adminCtx()
  await db.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'PENDING', nextRetryAt: new Date() } })
  await attemptDelivery(deliveryId)
  revalidatePath('/admin/webhooks')
}

export async function sendSampleWebhook() {
  const { orgId } = await adminCtx()
  await queueOutboundWebhook(orgId, 'conversion.created', {
    conversion_id: 'sample_conversion',
    order_id: 'SAMPLE-ORDER-1',
    affiliate_id: 'AFF-SAMPLE',
    revenue: 199.97,
    commission: 59.99,
    status: 'PENDING',
    sample: true,
  })
  revalidatePath('/admin/webhooks')
}

// ── Applications ────────────────────────────────────────────────────────────

export async function reviewApplication(applicationId: string, decision: 'APPROVED' | 'REJECTED' | 'NEEDS_INFO') {
  const { orgId, userId } = await adminCtx()
  const app = await db.affiliateApplication.findFirst({ where: { id: applicationId, organizationId: orgId } })
  if (!app) throw new Error('Not found')
  await db.affiliateApplication.update({ where: { id: applicationId }, data: { status: decision } })

  if (decision === 'APPROVED') {
    const [firstName, ...rest] = app.name.split(' ')
    const affiliate = await db.affiliate.create({
      data: {
        organizationId: orgId,
        affiliateCode: newAffiliateCode(),
        referralCode: newReferralCode(),
        firstName: firstName || app.name,
        lastName: rest.join(' ') || '',
        email: app.email.toLowerCase(),
        phone: app.phone,
        company: app.company,
        status: 'ACTIVE',
      },
    })
    await queueOutboundWebhook(orgId, 'affiliate.approved', { affiliate_id: affiliate.affiliateCode, email: affiliate.email })
  }
  await logAudit({ organizationId: orgId, userId, action: `application.${decision.toLowerCase()}`, targetType: 'AffiliateApplication', targetId: applicationId })
  revalidatePath('/admin/applications')
  revalidatePath('/admin/affiliates')
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function saveSettings(formData: FormData) {
  const { orgId, userId } = await adminCtx()
  const entries: [string, string][] = [
    ['attribution.cookie_window_days', String(formData.get('cookieWindow') ?? '30')],
    ['attribution.priority', String(formData.get('attributionPriority') ?? '')],
    ['commission.basis', String(formData.get('commissionBasis') ?? 'SUBTOTAL_AFTER_DISCOUNT')],
    ['conversions.auto_approve', formData.get('autoApprove') ? 'true' : 'false'],
    ['payouts.day_of_week', String(formData.get('payoutDay') ?? '5')],
    ['overrides.max_levels', String(formData.get('maxLevels') ?? '3')],
  ]
  const webhookSecret = String(formData.get('webhookSecret') ?? '')
  if (webhookSecret) entries.push(['webhook.secret', webhookSecret])
  for (const [key, value] of entries) {
    if (value !== '') await setSetting(orgId, key, value)
  }

  // override level percentages, e.g. level1=5, level2=3, level3=2
  for (let level = 1; level <= 5; level++) {
    const raw = formData.get(`level${level}`)
    if (raw == null || raw === '') continue
    const rateBps = Math.round(Number(raw) * 100)
    await db.overrideLevel.upsert({
      where: { organizationId_level: { organizationId: orgId, level } },
      create: { organizationId: orgId, level, rateBps, isActive: rateBps > 0 },
      update: { rateBps, isActive: rateBps > 0 },
    })
  }
  await logAudit({ organizationId: orgId, userId, action: 'settings.updated' })
  revalidatePath('/admin/settings')
}
