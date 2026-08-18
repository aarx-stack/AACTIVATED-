import { NextRequest, NextResponse } from 'next/server'
import { authenticateInbound, checkIdempotency, logInboundEvent } from '@/lib/webhook-ingest'
import { processRefund } from '@/lib/refunds'
import { apiError } from '@/lib/api-auth'
import { toCents } from '@/lib/money'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const auth = await authenticateInbound(req, rawBody, 'conversion:write')
  if ('error' in auth) return auth.error
  const { organizationId, ipAddress, idempotencyKey, signatureValid } = auth.ctx

  const prior = await checkIdempotency(organizationId, idempotencyKey)
  if (prior) return NextResponse.json({ ok: true, duplicate: true })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return apiError(400, 'invalid_json', 'Request body must be valid JSON.')
  }
  const event = String(body.event ?? 'order.refunded')
  const result = await processRefund({
    organizationId,
    externalOrderId: String(body.order_id ?? ''),
    refundAmount: body.refund_amount != null ? toCents(body.refund_amount as number | string) : null,
    kind: event === 'chargeback.created' ? 'CHARGEBACK' : event === 'order.cancelled' ? 'CANCELLED' : 'REFUND',
  })
  await logInboundEvent({
    organizationId, source: 'api', eventType: event, idempotencyKey,
    rawPayload: rawBody, signatureValid, httpStatus: result.ok ? 200 : 422,
    error: result.error ?? null, ipAddress,
  })
  if (!result.ok) return apiError(422, result.error!, `Refund failed: ${result.error}`)
  return NextResponse.json({ ok: true, reversed_commission: (result.reversedCents ?? 0) / 100 })
}
