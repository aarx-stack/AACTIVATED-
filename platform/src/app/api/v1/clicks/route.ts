import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApi, apiError, parsePagination } from '@/lib/api-auth'
import { recordClick } from '@/lib/clicks'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, 'conversion:read')
  if ('error' in auth) return auth.error
  const { skip, take, page, perPage } = parsePagination(req)
  const where = { organizationId: auth.ctx.organizationId }
  const [rows, total] = await Promise.all([
    db.click.findMany({
      where, skip, take,
      orderBy: { createdAt: 'desc' },
      include: { affiliate: { select: { affiliateCode: true } } },
    }),
    db.click.count({ where }),
  ])
  return NextResponse.json({
    data: rows.map(c => ({
      click_id: c.clickId,
      affiliate_id: c.affiliate.affiliateCode,
      landing_page: c.landingPage,
      utm_source: c.utmSource,
      device: c.device,
      country: c.country,
      created_at: c.createdAt,
    })),
    pagination: { page, per_page: perPage, total },
  })
}

const clickSchema = z.object({
  affiliate_id: z.string().min(1),
  landing_page: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
  session_id: z.string().optional().nullable(),
  utm_source: z.string().optional().nullable(),
  utm_medium: z.string().optional().nullable(),
  utm_campaign: z.string().optional().nullable(),
  utm_content: z.string().optional().nullable(),
  utm_term: z.string().optional().nullable(),
  ip: z.string().optional().nullable(),
  user_agent: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateApi(req, 'conversion:write')
  if ('error' in auth) return auth.error
  const parsed = clickSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Invalid payload.', issues: parsed.error.issues } },
      { status: 422 },
    )
  }
  const d = parsed.data
  const affiliate = await db.affiliate.findFirst({
    where: {
      organizationId: auth.ctx.organizationId,
      status: 'ACTIVE',
      OR: [{ affiliateCode: d.affiliate_id }, { referralCode: d.affiliate_id }, { id: d.affiliate_id }],
    },
  })
  if (!affiliate) return apiError(422, 'invalid_affiliate', 'Affiliate not found or not active.')
  const click = await recordClick({
    organizationId: auth.ctx.organizationId,
    affiliateId: affiliate.id,
    sessionId: d.session_id,
    landingPage: d.landing_page,
    referrer: d.referrer,
    utmSource: d.utm_source,
    utmMedium: d.utm_medium,
    utmCampaign: d.utm_campaign,
    utmContent: d.utm_content,
    utmTerm: d.utm_term,
    ipAddress: d.ip ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: d.user_agent ?? req.headers.get('user-agent'),
    country: d.country,
  })
  return NextResponse.json({ click_id: click.clickId, session_id: click.sessionId }, { status: 201 })
}
