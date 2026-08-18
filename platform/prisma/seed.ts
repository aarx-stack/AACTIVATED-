// Demo seed: 1 admin, 1 distributor, 5 reps, products, plans, promo codes,
// 100 clicks, 20 orders run through the REAL ingestion pipeline, payouts.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db } from '../src/lib/db'
import { newAffiliateCode, newReferralCode, newClickId } from '../src/lib/ids'
import { ingestOrder } from '../src/lib/conversions'
import { generatePayoutBatch, updatePayoutStatus } from '../src/lib/payouts'
import { setSetting } from '../src/lib/settings'

async function main() {
  console.log('Seeding…')

  const org = await db.organization.upsert({
    where: { slug: 'demo' },
    create: { name: 'Demo Storefront', slug: 'demo', supportEmail: 'support@example.com' },
    update: {},
  })

  await setSetting(org.id, 'conversions.auto_approve', 'true')
  await setSetting(org.id, 'attribution.cookie_window_days', '30')

  // override levels: L1 5%, L2 3%, L3 2%
  for (const [level, rateBps] of [[1, 500], [2, 300], [3, 200]] as const) {
    await db.overrideLevel.upsert({
      where: { organizationId_level: { organizationId: org.id, level } },
      create: { organizationId: org.id, level, rateBps },
      update: { rateBps },
    })
  }

  // users
  const password = await bcrypt.hash('admin1234', 10)
  const admin = await db.user.upsert({
    where: { email: 'admin@example.com' },
    create: { organizationId: org.id, email: 'admin@example.com', name: 'Admin', role: 'SUPER_ADMIN', passwordHash: password },
    update: {},
  })

  // commission plans
  const standardPlan = await db.commissionPlan.upsert({
    where: { id: 'plan-standard' },
    create: {
      id: 'plan-standard',
      organizationId: org.id,
      name: 'Standard 30%',
      basis: 'SUBTOTAL_AFTER_DISCOUNT',
      isDefault: true,
      rules: { create: [{ type: 'PERCENTAGE', rateBps: 3000 }] },
    },
    update: {},
  })
  await db.commissionPlan.upsert({
    where: { id: 'plan-tiered' },
    create: {
      id: 'plan-tiered',
      organizationId: org.id,
      name: 'Tiered 20-35%',
      basis: 'SUBTOTAL_AFTER_DISCOUNT',
      rules: {
        create: [
          { type: 'TIERED_PERCENTAGE', rateBps: 2000, tierMinCents: 0 },
          { type: 'TIERED_PERCENTAGE', rateBps: 2500, tierMinCents: 500_000 },
          { type: 'TIERED_PERCENTAGE', rateBps: 3000, tierMinCents: 1_000_000 },
          { type: 'TIERED_PERCENTAGE', rateBps: 3500, tierMinCents: 2_500_000 },
        ],
      },
    },
    update: {},
  })
  await db.commissionPlan.upsert({
    where: { id: 'plan-flat' },
    create: {
      id: 'plan-flat',
      organizationId: org.id,
      name: 'Flat $25/order',
      basis: 'SUBTOTAL_AFTER_DISCOUNT',
      rules: { create: [{ type: 'FLAT', flatCents: 2500 }] },
    },
    update: {},
  })

  // products
  const products = [
    { sku: 'PRODUCT-001', name: 'Recovery Formula', priceCents: 19997, costCents: 6000 },
    { sku: 'PRODUCT-002', name: 'Energy Boost', priceCents: 9999, costCents: 3000 },
    { sku: 'PRODUCT-003', name: 'Wellness Bundle', priceCents: 29999, costCents: 10000 },
  ]
  for (const p of products) {
    await db.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: p.sku } },
      create: { organizationId: org.id, ...p },
      update: {},
    })
  }

  // affiliates: distributor -> rep1 -> rep2 chain, plus rep3-5 under distributor
  async function makeAffiliate(opts: {
    first: string; last: string; email: string
    type: 'DISTRIBUTOR' | 'REP'
    parentId?: string | null
    withLogin?: boolean
  }) {
    const existing = await db.affiliate.findFirst({ where: { organizationId: org.id, email: opts.email } })
    if (existing) return existing
    let userId: string | undefined
    if (opts.withLogin) {
      const user = await db.user.upsert({
        where: { email: opts.email },
        create: {
          organizationId: org.id, email: opts.email,
          name: `${opts.first} ${opts.last}`, role: 'AFFILIATE',
          passwordHash: await bcrypt.hash('partner1234', 10),
        },
        update: {},
      })
      userId = user.id
    }
    return db.affiliate.create({
      data: {
        organizationId: org.id,
        userId,
        affiliateCode: newAffiliateCode(),
        referralCode: newReferralCode(),
        firstName: opts.first,
        lastName: opts.last,
        email: opts.email,
        type: opts.type,
        status: 'ACTIVE',
        parentId: opts.parentId ?? null,
        commissionPlanId: standardPlan.id,
        payoutMethod: 'PAYPAL',
      },
    })
  }

  const distributor = await makeAffiliate({ first: 'Dana', last: 'Distributor', email: 'dana@example.com', type: 'DISTRIBUTOR', withLogin: true })
  const rep1 = await makeAffiliate({ first: 'Riley', last: 'RepOne', email: 'riley@example.com', type: 'REP', parentId: distributor.id, withLogin: true })
  const rep2 = await makeAffiliate({ first: 'Jordan', last: 'RepTwo', email: 'jordan@example.com', type: 'REP', parentId: rep1.id, withLogin: true })
  const rep3 = await makeAffiliate({ first: 'Casey', last: 'RepThree', email: 'casey@example.com', type: 'REP', parentId: distributor.id })
  const rep4 = await makeAffiliate({ first: 'Morgan', last: 'RepFour', email: 'morgan@example.com', type: 'REP', parentId: distributor.id })
  const rep5 = await makeAffiliate({ first: 'Avery', last: 'RepFive', email: 'avery@example.com', type: 'REP', parentId: rep1.id })
  const reps = [rep1, rep2, rep3, rep4, rep5]

  // promo codes
  const promoDefs = [
    { code: 'SAVE10', affiliateId: rep1.id, discountBps: 1000 },
    { code: 'SAVE20', affiliateId: rep2.id, discountBps: 2000 },
    { code: 'REPCASEY15', affiliateId: rep3.id, discountBps: 1500 },
  ]
  for (const p of promoDefs) {
    await db.promoCode.upsert({
      where: { organizationId_code: { organizationId: org.id, code: p.code } },
      create: { organizationId: org.id, ...p },
      update: {},
    })
  }

  // 100 clicks spread over the last 30 days
  const existingClicks = await db.click.count({ where: { organizationId: org.id } })
  const clickIds: { clickId: string; affiliate: typeof rep1 }[] = []
  if (existingClicks < 100) {
    const sources = ['instagram', 'tiktok', 'youtube', 'facebook', 'email', null]
    const devices = ['mobile', 'desktop', 'tablet']
    const countries = ['US', 'US', 'US', 'CA', 'GB', 'AU']
    for (let i = 0; i < 100; i++) {
      const affiliate = reps[i % reps.length]
      const createdAt = new Date(Date.now() - Math.floor(Math.random() * 30) * 86_400_000 - Math.floor(Math.random() * 86_400_000))
      const click = await db.click.create({
        data: {
          organizationId: org.id,
          clickId: newClickId(),
          affiliateId: affiliate.id,
          landingPage: 'https://store.example.com/products/recovery-formula',
          referrer: 'https://instagram.com',
          utmSource: sources[i % sources.length],
          utmMedium: i % 3 === 0 ? 'social' : 'cpc',
          ipAddress: `203.0.113.${(i % 250) + 1}`,
          userAgent: 'Mozilla/5.0 (seed)',
          device: devices[i % devices.length],
          browser: 'chrome',
          country: countries[i % countries.length],
          createdAt,
        },
      })
      clickIds.push({ clickId: click.clickId, affiliate })
    }
  }

  // 20 orders through the real pipeline
  const existingOrders = await db.order.count({ where: { organizationId: org.id } })
  if (existingOrders < 20) {
    for (let i = 1; i <= 20; i++) {
      const affiliate = reps[i % reps.length]
      const product = products[i % products.length]
      const qty = (i % 2) + 1
      const subtotal = (product.priceCents * qty) / 100
      const discount = i % 4 === 0 ? 20 : 0
      const shipping = 10
      const tax = Number((subtotal * 0.08).toFixed(2))
      const useClick = i % 3 === 0 && clickIds.length > 0
      const usePromo = i % 5 === 0
      const daysAgo = Math.floor(Math.random() * 28)
      await ingestOrder({
        organizationId: org.id,
        source: 'seed',
        payload: {
          event: 'order.completed',
          order_id: `DEMO-ORDER-${1000 + i}`,
          customer_id: `CUS-${2000 + i}`,
          customer_email: `customer${i}@example.com`,
          subtotal,
          discount,
          shipping,
          tax,
          total: Number((subtotal - discount + shipping + tax).toFixed(2)),
          currency: 'USD',
          promo_code: usePromo ? 'SAVE20' : null,
          affiliate_id: useClick || usePromo ? null : affiliate.referralCode,
          click_id: useClick ? clickIds[i % clickIds.length].clickId : null,
          products: [{ sku: product.sku, name: product.name, quantity: qty, unit_price: product.priceCents / 100 }],
          created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
        },
      })
    }
  }

  // a refund on one order to demonstrate reversals
  const { processRefund } = await import('../src/lib/refunds')
  await processRefund({ organizationId: org.id, externalOrderId: 'DEMO-ORDER-1004', kind: 'REFUND' }).catch(() => {})

  // payout batch, mark first one paid
  const existingPayouts = await db.payout.count({ where: { organizationId: org.id } })
  if (existingPayouts === 0) {
    await generatePayoutBatch({ organizationId: org.id })
    const first = await db.payout.findFirst({ where: { organizationId: org.id } })
    if (first) await updatePayoutStatus(first.id, 'PAID')
  }

  console.log('Seed complete.')
  console.log('  Admin login:     admin@example.com / admin1234')
  console.log('  Distributor:     dana@example.com / partner1234')
  console.log('  Rep logins:      riley@example.com, jordan@example.com / partner1234')
  console.log(`  Admin user id:   ${admin.id}`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
