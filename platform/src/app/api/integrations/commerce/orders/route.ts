// Generic commerce order ingestion with storefront adapters.
// POST /api/integrations/commerce/orders?adapter=sellavi|shopify|woocommerce|custom
import { NextRequest, NextResponse } from 'next/server'
import { authenticateInbound, checkIdempotency, logInboundEvent } from '@/lib/webhook-ingest'
import { getAdapter } from '@/lib/adapters'
import { ingestOrder } from '@/lib/conversions'
import { apiError } from '@/lib/api-auth'

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

  let normalized
  try {
    normalized = adapter.normalizeOrder(raw)
  } catch (e) {
    await logInboundEvent({
      organizationId, source: adapter.name, eventType: 'order', idempotencyKey,
      rawPayload: rawBody, signatureValid, httpStatus: 422,
      error: e instanceof Error ? e.message : 'normalization failed', ipAddress,
    })
    return apiError(422, 'normalization_failed', `Could not normalize ${adapter.name} payload.`)
  }

  const result = await ingestOrder({ organizationId, payload: normalized, source: adapter.name })
  await logInboundEvent({
    organizationId, source: adapter.name, eventType: 'order', idempotencyKey,
    rawPayload: rawBody, normalizedPayload: JSON.stringify(normalized),
    signatureValid, httpStatus: result.ok ? 201 : 422, error: result.error ?? null, ipAddress,
  })
  if (!result.ok) return apiError(422, result.error ?? 'ingest_failed', 'Order ingestion failed.')
  return NextResponse.json({ ok: true, duplicate: result.duplicate ?? false, conversion_id: result.conversionId }, { status: 201 })
}
