// API key authentication + permission checks + basic rate limiting for the
// public REST API. Keys are stored as SHA-256 hashes; secrets never persist.
import { NextRequest, NextResponse } from 'next/server'
import { db } from './db'
import { hashApiKey } from './crypto'

export interface ApiContext {
  organizationId: string
  apiKeyId: string
  permissions: string[]
  mode: 'LIVE' | 'TEST'
}

// simple in-memory sliding window rate limiter (per API key)
const WINDOW_MS = 60_000
const MAX_REQUESTS = 120
const buckets = new Map<string, number[]>()

function rateLimited(keyId: string): boolean {
  const now = Date.now()
  const hits = (buckets.get(keyId) ?? []).filter(t => now - t < WINDOW_MS)
  if (hits.length >= MAX_REQUESTS) {
    buckets.set(keyId, hits)
    return true
  }
  hits.push(now)
  buckets.set(keyId, hits)
  return false
}

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

/**
 * Authenticate a request via the X-API-Key header (Bearer token also accepted)
 * and verify the required permission (e.g. "conversion:write").
 */
export async function authenticateApi(
  req: NextRequest,
  requiredPermission?: string,
): Promise<{ ctx: ApiContext } | { error: NextResponse }> {
  const headerKey =
    req.headers.get('x-api-key') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null
  if (!headerKey) return { error: apiError(401, 'missing_api_key', 'Provide an API key via the X-API-Key header.') }

  const record = await db.apiKey.findUnique({ where: { keyHash: hashApiKey(headerKey) } })
  if (!record || record.revokedAt) {
    return { error: apiError(401, 'invalid_api_key', 'API key is invalid or revoked.') }
  }
  if (rateLimited(record.id)) {
    return { error: apiError(429, 'rate_limited', 'Too many requests. Limit: 120/minute.') }
  }

  const permissions = record.permissions.split(',').map(p => p.trim())
  if (requiredPermission && !permissions.includes(requiredPermission) && !permissions.includes('*')) {
    return { error: apiError(403, 'insufficient_permissions', `Missing permission: ${requiredPermission}`) }
  }

  db.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {})

  return {
    ctx: {
      organizationId: record.organizationId,
      apiKeyId: record.id,
      permissions,
      mode: record.mode as 'LIVE' | 'TEST',
    },
  }
}

/** Standard pagination parsing: ?page=1&per_page=25 (max 100). */
export function parsePagination(req: NextRequest) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? 1) || 1)
  const perPage = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('per_page') ?? 25) || 25))
  return { skip: (page - 1) * perPage, take: perPage, page, perPage }
}
