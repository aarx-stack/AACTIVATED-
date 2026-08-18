// Refund / chargeback processing: reverse commissions with balancing ledger
// entries. Financial history is never deleted or edited — only appended to.
import { db } from './db'
import { proRata } from './money'
import { queueOutboundWebhook } from './webhooks-out'

export interface RefundResult {
  ok: boolean
  error?: string
  orderId?: string
  reversedCents?: number
}

/**
 * Process a refund (full or partial) or chargeback for an order.
 * Partial refunds reverse commissions proportionally to the refunded amount.
 */
export async function processRefund(opts: {
  organizationId: string
  externalOrderId: string
  refundAmount?: number | null // cents; null/undefined = full refund
  kind: 'REFUND' | 'CHARGEBACK' | 'CANCELLED'
}): Promise<RefundResult> {
  const { organizationId, externalOrderId, kind } = opts

  const order = await db.order.findUnique({
    where: { organizationId_externalOrderId: { organizationId, externalOrderId } },
    include: { conversions: { include: { commissions: true } } },
  })
  if (!order) return { ok: false, error: 'order_not_found' }

  const refundable = order.totalCents - order.refundedCents
  const refundCents = Math.min(opts.refundAmount ?? refundable, refundable)
  if (refundCents <= 0) return { ok: false, error: 'nothing_to_refund' }
  const isFull = order.refundedCents + refundCents >= order.totalCents

  const ledgerType = kind === 'CHARGEBACK' ? 'CHARGEBACK_REVERSAL' : 'REFUND_REVERSAL'
  let totalReversed = 0

  await db.$transaction(async tx => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        refundedCents: { increment: refundCents },
        status: kind === 'CANCELLED' ? 'CANCELLED' : isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    })

    for (const conv of order.conversions) {
      for (const commission of conv.commissions) {
        if (commission.status === 'REVERSED') continue
        const remaining = commission.amountCents - commission.reversedCents
        if (remaining <= 0) continue
        // proportional reversal on partial refund; full reversal otherwise
        const reversal = isFull
          ? remaining
          : Math.min(remaining, proRata(commission.amountCents, refundCents, order.totalCents))
        if (reversal <= 0) continue
        totalReversed += reversal

        const nowFullyReversed = commission.reversedCents + reversal >= commission.amountCents
        await tx.commission.update({
          where: { id: commission.id },
          data: {
            reversedCents: { increment: reversal },
            status: nowFullyReversed ? 'REVERSED' : commission.status,
          },
        })
        await tx.commissionLedger.create({
          data: {
            organizationId,
            affiliateId: commission.affiliateId,
            type: ledgerType,
            amountCents: -reversal,
            commissionId: commission.id,
            conversionId: conv.id,
            description: `${kind === 'CHARGEBACK' ? 'Chargeback' : 'Refund'} reversal for order ${externalOrderId}`,
          },
        })
      }

      await tx.conversion.update({
        where: { id: conv.id },
        data: isFull
          ? { status: kind === 'CHARGEBACK' ? 'CHARGEBACK' : 'REFUNDED' }
          : {},
      })
    }
  })

  await queueOutboundWebhook(
    organizationId,
    kind === 'CHARGEBACK' ? 'chargeback.created' : 'refund.created',
    { order_id: externalOrderId, refund_amount: refundCents / 100, reversed_commission: totalReversed / 100 },
  )

  return { ok: true, orderId: order.id, reversedCents: totalReversed }
}
