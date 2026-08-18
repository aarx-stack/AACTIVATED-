// Payout batches: approved commissions earned during a week become payable
// the following Friday (configurable via payouts.day_of_week).
import { db } from './db'
import { getSetting, SETTING_KEYS } from './settings'
import { queueOutboundWebhook } from './webhooks-out'

/** Next payout date strictly after `after`, on the configured weekday. */
export function nextPayoutDate(after: Date, payoutDay: number): Date {
  const d = new Date(after)
  d.setHours(0, 0, 0, 0)
  do {
    d.setDate(d.getDate() + 1)
  } while (d.getDay() !== payoutDay)
  return d
}

/**
 * Generate a payout batch: collect approved, unreversed, not-yet-paid
 * commissions approved on or before the cutoff and group them per affiliate.
 */
export async function generatePayoutBatch(opts: {
  organizationId: string
  cutoff?: Date
}): Promise<{ batchKey: string; payouts: number; totalCents: number }> {
  const { organizationId } = opts
  const cutoff = opts.cutoff ?? new Date()
  const payoutDay = Number(await getSetting(organizationId, SETTING_KEYS.payoutDay))
  const batchDate = nextPayoutDate(cutoff, payoutDay)
  const batchKey = batchDate.toISOString().slice(0, 10)

  const commissions = await db.commission.findMany({
    where: {
      organizationId,
      status: 'APPROVED',
      approvedAt: { lte: cutoff },
      payoutItems: { none: {} },
    },
    include: { affiliate: true },
  })

  const byAffiliate = new Map<string, typeof commissions>()
  for (const c of commissions) {
    const net = c.amountCents - c.reversedCents
    if (net <= 0) continue
    const list = byAffiliate.get(c.affiliateId) ?? []
    list.push(c)
    byAffiliate.set(c.affiliateId, list)
  }

  let payouts = 0
  let totalCents = 0

  for (const [affiliateId, comms] of byAffiliate) {
    const amountCents = comms.reduce((s, c) => s + (c.amountCents - c.reversedCents), 0)
    if (amountCents <= 0) continue
    const affiliate = comms[0].affiliate
    await db.$transaction(async tx => {
      const payout = await tx.payout.create({
        data: {
          organizationId,
          affiliateId,
          batchKey,
          amountCents,
          method: affiliate.payoutMethod ?? 'MANUAL',
        },
      })
      for (const c of comms) {
        await tx.payoutItem.create({
          data: { payoutId: payout.id, commissionId: c.id, amountCents: c.amountCents - c.reversedCents },
        })
      }
    })
    payouts++
    totalCents += amountCents
    await queueOutboundWebhook(organizationId, 'payout.created', {
      affiliate_id: affiliate.affiliateCode,
      amount: amountCents / 100,
      batch: batchKey,
    })
  }

  return { batchKey, payouts, totalCents }
}

/** Mark a payout paid/processing/failed, appending the matching ledger entry. */
export async function updatePayoutStatus(payoutId: string, status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'HELD') {
  const payout = await db.payout.findUnique({ where: { id: payoutId }, include: { items: true } })
  if (!payout) throw new Error('payout_not_found')

  await db.$transaction(async tx => {
    await tx.payout.update({
      where: { id: payoutId },
      data: { status, paidAt: status === 'PAID' ? new Date() : payout.paidAt },
    })
    if (status === 'PAID' && payout.status !== 'PAID') {
      await tx.commissionLedger.create({
        data: {
          organizationId: payout.organizationId,
          affiliateId: payout.affiliateId,
          type: 'PAYOUT',
          amountCents: -payout.amountCents,
          payoutId: payout.id,
          description: `Payout ${payout.batchKey}`,
        },
      })
      for (const item of payout.items) {
        await tx.commission.update({ where: { id: item.commissionId }, data: { status: 'PAID' } })
      }
    }
  })

  if (status === 'PAID') {
    await queueOutboundWebhook(payout.organizationId, 'payout.completed', {
      payout_id: payout.id,
      amount: payout.amountCents / 100,
    })
  }
}

/** Affiliate balance summary derived from the immutable ledger. */
export async function affiliateBalances(organizationId: string, affiliateId: string) {
  const [pending, approved, ledgerSum, paidOut] = await Promise.all([
    db.commission.aggregate({
      where: { organizationId, affiliateId, status: 'PENDING' },
      _sum: { amountCents: true, reversedCents: true },
    }),
    db.commission.aggregate({
      where: { organizationId, affiliateId, status: 'APPROVED' },
      _sum: { amountCents: true, reversedCents: true },
    }),
    db.commissionLedger.aggregate({
      where: { organizationId, affiliateId },
      _sum: { amountCents: true },
    }),
    db.commissionLedger.aggregate({
      where: { organizationId, affiliateId, type: 'PAYOUT' },
      _sum: { amountCents: true },
    }),
  ])
  return {
    pendingCents: (pending._sum.amountCents ?? 0) - (pending._sum.reversedCents ?? 0),
    approvedCents: (approved._sum.amountCents ?? 0) - (approved._sum.reversedCents ?? 0),
    balanceCents: ledgerSum._sum.amountCents ?? 0,
    paidCents: -(paidOut._sum.amountCents ?? 0),
  }
}
