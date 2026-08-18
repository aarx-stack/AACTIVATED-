import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApi, apiError, parsePagination } from '@/lib/api-auth'
import { newAffiliateCode, newReferralCode } from '@/lib/ids'
import { z } from 'zod'

const createSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  type: z.enum(['AFFILIATE', 'REP', 'DISTRIBUTOR']).optional().default('AFFILIATE'),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional().default('PENDING'),
  parent_affiliate_id: z.string().optional().nullable(),
  commission_plan_id: z.string().optional().nullable(),
  payout_method: z.string().optional().nullable(),
})

export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, 'affiliate:read')
  if ('error' in auth) return auth.error
  const { skip, take, page, perPage } = parsePagination(req)
  const status = req.nextUrl.searchParams.get('status')
  const q = req.nextUrl.searchParams.get('q')

  const where = {
    organizationId: auth.ctx.organizationId,
    ...(status ? { status: status.toUpperCase() as never } : {}),
    ...(q
      ? { OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { firstName: { contains: q, mode: 'insensitive' as const } },
          { lastName: { contains: q, mode: 'insensitive' as const } },
          { affiliateCode: { contains: q, mode: 'insensitive' as const } },
        ] }
      : {}),
  }
  const [rows, total] = await Promise.all([
    db.affiliate.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    db.affiliate.count({ where }),
  ])
  return NextResponse.json({
    data: rows.map(a => ({
      id: a.affiliateCode,
      referral_code: a.referralCode,
      first_name: a.firstName,
      last_name: a.lastName,
      email: a.email,
      type: a.type,
      status: a.status,
      joined_at: a.joinedAt,
    })),
    pagination: { page, per_page: perPage, total },
  })
}

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
  let parentId: string | null = null
  if (d.parent_affiliate_id) {
    const parent = await db.affiliate.findFirst({
      where: { organizationId: auth.ctx.organizationId, OR: [{ id: d.parent_affiliate_id }, { affiliateCode: d.parent_affiliate_id }] },
    })
    if (!parent) return apiError(422, 'invalid_parent', 'Parent affiliate not found.')
    parentId = parent.id
  }
  const affiliate = await db.affiliate.create({
    data: {
      organizationId: auth.ctx.organizationId,
      affiliateCode: newAffiliateCode(),
      referralCode: newReferralCode(),
      firstName: d.first_name,
      lastName: d.last_name,
      email: d.email.toLowerCase(),
      phone: d.phone ?? null,
      company: d.company ?? null,
      type: d.type,
      status: d.status,
      parentId,
      commissionPlanId: d.commission_plan_id ?? null,
      payoutMethod: d.payout_method ?? null,
    },
  })
  return NextResponse.json(
    {
      id: affiliate.affiliateCode,
      referral_code: affiliate.referralCode,
      tracking_url: `${process.env.APP_URL}/r/${affiliate.referralCode}`,
      status: affiliate.status,
    },
    { status: 201 },
  )
}
