import { db } from './db'
import { decryptSecret, signWebhook } from './crypto'

export type OutboundEvent =
  | 'affiliate.created'
  | 'affiliate.approved'
  | 'click.created'
  | 'conversion.created'
  | 'conversion.approved'
  | 'conversion.rejected'
  | 'commission.created'
  | 'commission.approved'
  | 'payout.created'
  | 'payout.completed'
  | 'refund.created'
  | 'chargeback.created'

/** Queue an outbound webhook for every active endpoint subscribed to the event. */
export async function queueOutboundWebhook(
  organizationId: string,
  eventType: OutboundEvent,
  data: unknown,
) {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { organizationId, isActive: true },
  })
  const payload = JSON.stringify({ event: eventType, created_at: new Date().toISOString(), data })
  for (const ep of endpoints) {
    const events = ep.events.split(',').map(e => e.trim())
    if (!events.includes(eventType) && !events.includes('*')) continue
    await db.webhookDelivery.create({
      data: { endpointId: ep.id, eventType, payload, nextRetryAt: new Date() },
    })
  }
  // fire-and-forget delivery attempt (retries picked up by processPendingDeliveries)
  processPendingDeliveries().catch(() => {})
}

const MAX_ATTEMPTS = 6

/** Deliver pending webhooks with exponential backoff (1m, 5m, 25m, ...). */
export async function processPendingDeliveries(limit = 20) {
  const pending = await db.webhookDelivery.findMany({
    where: { status: 'PENDING', nextRetryAt: { lte: new Date() } },
    take: limit,
    include: { endpoint: true },
  })
  for (const d of pending) {
    await attemptDelivery(d.id)
  }
}

export async function attemptDelivery(deliveryId: string) {
  const d = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  })
  if (!d || d.status === 'DELIVERED') return
  const timestamp = String(Math.floor(Date.now() / 1000))
  let secret = ''
  try {
    secret = decryptSecret(d.endpoint.secret)
  } catch {
    secret = d.endpoint.secret
  }
  const signature = signWebhook(secret, timestamp, d.payload)
  let status: number | null = null
  let error: string | null = null
  try {
    const res = await fetch(d.endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp,
      },
      body: d.payload,
      signal: AbortSignal.timeout(10_000),
    })
    status = res.status
    if (!res.ok) error = `HTTP ${res.status}`
  } catch (e) {
    error = e instanceof Error ? e.message : 'delivery failed'
  }

  const attempts = d.attempts + 1
  if (!error) {
    await db.webhookDelivery.update({
      where: { id: d.id },
      data: { attempts, lastStatus: status, lastError: null, status: 'DELIVERED', nextRetryAt: null },
    })
  } else {
    const failed = attempts >= MAX_ATTEMPTS
    const backoffMs = 60_000 * Math.pow(5, attempts - 1)
    await db.webhookDelivery.update({
      where: { id: d.id },
      data: {
        attempts,
        lastStatus: status,
        lastError: error,
        status: failed ? 'FAILED' : 'PENDING',
        nextRetryAt: failed ? null : new Date(Date.now() + backoffMs),
      },
    })
  }
}
