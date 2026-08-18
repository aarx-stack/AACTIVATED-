import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApi, apiError } from '@/lib/api-auth'
import { z } from 'zod'

async function findAffiliate(organizationId: string, id: string) {
  return db.affiliate.findFirst({
    where: { organizationId, OR: [{ id }, { affiliateCode: id }, { referralCode: id }] },
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApi(req, 'affiliate:read')
  if ('error' in auth) return auth.error
  const { id } = await params
  const a = await findAffiliate(auth.ctx.organizationId, id)
  if (!a) return apiError(404, 'not_found', 'Affiliate not found.')
  const stats = await db.conversion.aggregate({
    where: { affiliateId: a.id, status: { notIn: ['REJECTED'] } },
    _sum: { revenueCents: true, commissionCents: true },
    _count: true,
  })
  return NextResponse.json({
    id: a.affiliateCode,
    referral_code: a.referralCode,
    first_name: a.firstName,
    last_name: a.lastName,
    email: a.email,
    phone: a.phone,
    company: a.company,
    type: a.type,
    status: a.status,
    payout_method: a.payoutMethod,
    joined_at: a.joinedAt,
    stats: {
      conversions: stats._count,
      revenue: (stats._sum.revenueCents ?? 0) / 100,
      commission: (stats._sum.commissionCents ?? 0) / 100,
    },
  })
}

const patchSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
  payout_method: z.string().nullable().optional(),
  commission_plan_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApi(req, 'affiliate:write')
  if ('error' in auth) return auth.error
  const { id } = await params
  const a = await findAffiliate(auth.ctx.organizationId, id)
  if (!a) return apiError(404, 'not_found', 'Affiliate not found.')
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Invalid payload.', issues: parsed.error.issues } },
      { status: 422 },
    )
  }
  const d = parsed.data
  const updated = await db.affiliate.update({
    where: { id: a.id },
    data: {
      firstName: d.first_name,
      lastName: d.last_name,
      phone: d.phone,
      company: d.company,
      status: d.status,
      payoutMethod: d.payout_method,
      commissionPlanId: d.commission_plan_id,
      notes: d.notes,
    },
  })
  return NextResponse.json({ id: updated.affiliateCode, status: updated.status })
}
