// POST /api/integrations/commerce/refunds?adapter=...
import { NextRequest, NextResponse } from 'next/server'
import { authenticateInbound, checkIdempotency, logInboundEvent } from '@/lib/webhook-ingest'
import { getAdapter } from '@/lib/adapters'
import { processRefund } from '@/lib/refunds'
import { apiError } from '@/lib/api-auth'
import { toCents } from '@/lib/money'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const auth = await authenticateInbound(req, rawBody, 'conversion:write')
  if ('error' in auth) return auth.error
  const { organizationId, ipAddress, idempotencyKey, signatureValid } = auth.ctx
  const adapter = getAdapter(req.nextUrl.searchParams.get('adapter'))

  const prior = await checkIdempotency(organizationId, idempotencyKey)
  if (prior) return NextResponse.json({ ok: true, duplicate: true })

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(rawBody)
  } catch {
    return apiError(400, 'invalid_json', 'Request body must be valid JSON.')
  }

  let refund
  try {
    refund = adapter.normalizeRefund(raw)
  } catch {
    return apiError(422, 'normalization_failed', `Could not normalize ${adapter.name} refund payload.`)
  }

  const result = await processRefund({
    organizationId,
    externalOrderId: refund.order_id,
    refundAmount: refund.amount != null ? toCents(refund.amount) : null,
    kind: refund.kind,
  })
  await logInboundEvent({
    organizationId, source: adapter.name, eventType: 'refund', idempotencyKey,
    rawPayload: rawBody, signatureValid, httpStatus: result.ok ? 200 : 422,
    error: result.error ?? null, ipAddress,
  })
  if (!result.ok) return apiError(422, result.error!, `Refund failed: ${result.error}`)
  return NextResponse.json({ ok: true, reversed_commission: (result.reversedCents ?? 0) / 100 })
}
