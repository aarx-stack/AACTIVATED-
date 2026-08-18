// POST /api/v1/conversions — order/conversion webhook ingestion.
// GET  /api/v1/conversions — list conversions (conversion:read).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApi, apiError, parsePagination } from '@/lib/api-auth'
import { authenticateInbound, checkIdempotency, logInboundEvent } from '@/lib/webhook-ingest'
import { ingestOrder, orderPayloadSchema } from '@/lib/conversions'
import { processRefund } from '@/lib/refunds'
import { toCents } from '@/lib/money'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const auth = await authenticateInbound(req, rawBody, 'conversion:write')
  if ('error' in auth) return auth.error
  const { organizationId, ipAddress, idempotencyKey, signatureValid } = auth.ctx

  const prior = await checkIdempotency(organizationId, idempotencyKey)
  if (prior) {
    return NextResponse.json(
      { ok: true, duplicate: true, message: 'Idempotency key already processed.' },
      { status: 200 },
    )
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    await logInboundEvent({
      organizationId, source: 'api', eventType: 'invalid', idempotencyKey,
      rawPayload: rawBody.slice(0, 10000), signatureValid, httpStatus: 400,
      error: 'invalid_json', ipAddress,
    })
    return apiError(400, 'invalid_json', 'Request body must be valid JSON.')
  }

  const event = String((json as Record<string, unknown>).event ?? 'order.completed')

  // refund-style events routed to the refund processor
  if (['order.refunded', 'order.partially_refunded', 'order.cancelled', 'chargeback.created'].includes(event)) {
    const body = json as Record<string, unknown>
    const result = await processRefund({
      organizationId,
      externalOrderId: String(body.order_id ?? ''),
      refundAmount: body.refund_amount != null ? toCents(body.refund_amount as number | string) : null,
      kind: event === 'chargeback.created' ? 'CHARGEBACK' : event === 'order.cancelled' ? 'CANCELLED' : 'REFUND',
    })
    const status = result.ok ? 200 : 422
    await logInboundEvent({
      organizationId, source: 'api', eventType: event, idempotencyKey,
      rawPayload: rawBody, signatureValid, httpStatus: status,
      error: result.error ?? null, ipAddress,
    })
    if (!result.ok) return apiError(422, result.error!, `Refund failed: ${result.error}`)
    return NextResponse.json({ ok: true, reversed_commission: (result.reversedCents ?? 0) / 100 })
  }

  const parsed = orderPayloadSchema.safeParse(json)
  if (!parsed.success) {
    await logInboundEvent({
      organizationId, source: 'api', eventType: event, idempotencyKey,
      rawPayload: rawBody, signatureValid, httpStatus: 422,
      error: JSON.stringify(parsed.error.issues.slice(0, 5)), ipAddress,
    })
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Payload validation failed.', issues: parsed.error.issues } },
      { status: 422 },
    )
  }

  const result = await ingestOrder({ organizationId, payload: parsed.data, source: 'api' })
  await logInboundEvent({
    organizationId, source: 'api', eventType: event, idempotencyKey,
    rawPayload: rawBody, normalizedPayload: JSON.stringify(parsed.data),
    signatureValid, httpStatus: result.ok ? (result.duplicate ? 200 : 201) : 422,
    error: result.error ?? null, ipAddress,
  })

  if (!result.ok) return apiError(422, result.error ?? 'ingest_failed', 'Order ingestion failed.')
  return NextResponse.json(
    {
      ok: true,
      duplicate: result.duplicate ?? false,
      conversion_id: result.conversionId,
      affiliate_id: result.affiliateCode,
      attribution: result.attributionMethod,
      commission: (result.commissionCents ?? 0) / 100,
      overrides: (result.overrideCents ?? 0) / 100,
    },
    { status: result.duplicate ? 200 : 201 },
  )
}

export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, 'conversion:read')
  if ('error' in auth) return auth.error
  const { skip, take, page, perPage } = parsePagination(req)
  const status = req.nextUrl.searchParams.get('status')

  const where = {
    organizationId: auth.ctx.organizationId,
    ...(status ? { status: status.toUpperCase() as never } : {}),
  }
  const [rows, total] = await Promise.all([
    db.conversion.findMany({
      where, skip, take,
      orderBy: { convertedAt: 'desc' },
      include: { affiliate: { select: { affiliateCode: true } }, order: { select: { externalOrderId: true } } },
    }),
    db.conversion.count({ where }),
  ])
  return NextResponse.json({
    data: rows.map(c => ({
      id: c.id,
      order_id: c.order.externalOrderId,
      affiliate_id: c.affiliate?.affiliateCode ?? null,
      status: c.status,
      attribution: c.attributionMethod,
      revenue: c.revenueCents / 100,
      commission: c.commissionCents / 100,
      overrides: c.overrideCents / 100,
      promo_code: c.promoCode,
      click_id: c.clickIdRaw,
      converted_at: c.convertedAt,
    })),
    pagination: { page, per_page: perPage, total },
  })
}
