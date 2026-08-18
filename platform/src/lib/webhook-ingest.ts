// Shared inbound-webhook plumbing: authentication (API key or HMAC),
// idempotency via X-Idempotency-Key, and raw payload logging.
import { NextRequest, NextResponse } from 'next/server'
import { db } from './db'
import { authenticateApi } from './api-auth'
import { verifyWebhookSignature } from './crypto'
import { getSetting } from './settings'

export interface InboundContext {
  organizationId: string
  rawBody: string
  ipAddress: string | null
  idempotencyKey: string | null
  signatureValid: boolean | null
}

export async function defaultOrganizationId(): Promise<string | null> {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } })
  return org?.id ?? null
}

/**
 * Authenticate an inbound webhook request. Accepts either:
 *  - X-API-Key with the required permission, or
 *  - X-Webhook-Signature + X-Webhook-Timestamp (HMAC-SHA256 of `${ts}.${body}`
 *    with the organization's webhook secret).
 */
export async function authenticateInbound(
  req: NextRequest,
  rawBody: string,
  permission: string,
): Promise<{ ctx: InboundContext } | { error: NextResponse }> {
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const idempotencyKey = req.headers.get('x-idempotency-key')

  if (req.headers.get('x-api-key') || req.headers.get('authorization')) {
    const result = await authenticateApi(req, permission)
    if ('error' in result) return { error: result.error }
    return {
      ctx: {
        organizationId: result.ctx.organizationId,
        rawBody,
        ipAddress,
        idempotencyKey,
        signatureValid: null,
      },
    }
  }

  const signature = req.headers.get('x-webhook-signature')
  const timestamp = req.headers.get('x-webhook-timestamp')
  if (signature) {
    const orgId = await defaultOrganizationId()
    if (!orgId) {
      return { error: NextResponse.json({ error: { code: 'no_organization', message: 'Platform not initialized.' } }, { status: 500 }) }
    }
    const secret = (await getSetting(orgId, 'webhook.secret')) || process.env.WEBHOOK_SECRET || ''
    const check = verifyWebhookSignature({ secret, signature, timestamp, rawBody })
    if (!check.ok) {
      return { error: NextResponse.json({ error: { code: 'invalid_signature', message: check.reason } }, { status: 401 }) }
    }
    return { ctx: { organizationId: orgId, rawBody, ipAddress, idempotencyKey, signatureValid: true } }
  }

  return {
    error: NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Provide X-API-Key or X-Webhook-Signature + X-Webhook-Timestamp.' } },
      { status: 401 },
    ),
  }
}

/**
 * Idempotency guard: if this key was already processed, return the logged
 * event so the caller can short-circuit with the same response.
 */
export async function checkIdempotency(organizationId: string, idempotencyKey: string | null) {
  if (!idempotencyKey) return null
  return db.webhookEvent.findUnique({
    where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
  })
}

export async function logInboundEvent(opts: {
  organizationId: string
  source: string
  eventType: string
  idempotencyKey: string | null
  rawPayload: string
  normalizedPayload?: string | null
  signatureValid: boolean | null
  httpStatus: number
  error?: string | null
  ipAddress: string | null
}) {
  try {
    return await db.webhookEvent.create({
      data: {
        organizationId: opts.organizationId,
        direction: 'INBOUND',
        source: opts.source,
        eventType: opts.eventType,
        idempotencyKey: opts.idempotencyKey,
        rawPayload: opts.rawPayload,
        normalizedPayload: opts.normalizedPayload ?? null,
        signatureValid: opts.signatureValid,
        httpStatus: opts.httpStatus,
        error: opts.error ?? null,
        ipAddress: opts.ipAddress,
      },
    })
  } catch {
    // duplicate idempotency key raced in — treat as already logged
    return null
  }
}
