import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApi, parsePagination } from '@/lib/api-auth'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, 'affiliate:read')
  if ('error' in auth) return auth.error
  const { skip, take, page, perPage } = parsePagination(req)
  const where = { organizationId: auth.ctx.organizationId }
  const [rows, total] = await Promise.all([
    db.offer.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    db.offer.count({ where }),
  ])
  return NextResponse.json({
    data: rows.map(o => ({
      id: o.id,
      name: o.name,
      status: o.status,
      landing_page: o.landingPageUrl,
      attribution_window_days: o.attributionWindowDays,
      default_payout_percent: o.defaultPayoutBps != null ? o.defaultPayoutBps / 100 : null,
      default_payout_flat: o.defaultPayoutCents != null ? o.defaultPayoutCents / 100 : null,
    })),
    pagination: { page, per_page: perPage, total },
  })
}

const createSchema = z.object({
  name: z.string().min(1),
  landing_page: z.string().url(),
  description: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional().default('DRAFT'),
  attribution_window_days: z.number().int().positive().optional().default(30),
  default_payout_percent: z.number().min(0).max(100).optional().nullable(),
  advertiser_id: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateApi(req, 'affiliate:write')
  if ('error' in auth) return auth.error
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Invalid payload.', issues: parsed.error.issues } },
      { status: 422 },
    )
  }
  const d = parsed.data
  const offer = await db.offer.create({
    data: {
      organizationId: auth.ctx.organizationId,
      name: d.name,
      landingPageUrl: d.landing_page,
      description: d.description ?? null,
      status: d.status,
      attributionWindowDays: d.attribution_window_days,
      defaultPayoutBps: d.default_payout_percent != null ? Math.round(d.default_payout_percent * 100) : null,
      advertiserId: d.advertiser_id ?? null,
    },
  })
  return NextResponse.json({ id: offer.id, name: offer.name, status: offer.status }, { status: 201 })
}
