import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApi, parsePagination } from '@/lib/api-auth'
import { generatePayoutBatch } from '@/lib/payouts'

export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, 'payout:read')
  if ('error' in auth) return auth.error
  const { skip, take, page, perPage } = parsePagination(req)
  const where = { organizationId: auth.ctx.organizationId }
  const [rows, total] = await Promise.all([
    db.payout.findMany({
      where, skip, take,
      orderBy: { createdAt: 'desc' },
      include: { affiliate: { select: { affiliateCode: true } } },
    }),
    db.payout.count({ where }),
  ])
  return NextResponse.json({
    data: rows.map(p => ({
      id: p.id,
      affiliate_id: p.affiliate.affiliateCode,
      batch: p.batchKey,
      amount: p.amountCents / 100,
      method: p.method,
      status: p.status,
      paid_at: p.paidAt,
    })),
    pagination: { page, per_page: perPage, total },
  })
}

/** POST /api/v1/payouts — generate the next payout batch from approved commissions. */
export async function POST(req: NextRequest) {
  const auth = await authenticateApi(req, 'payout:write')
  if ('error' in auth) return auth.error
  const result = await generatePayoutBatch({ organizationId: auth.ctx.organizationId })
  return NextResponse.json(
    { batch: result.batchKey, payouts: result.payouts, total: result.totalCents / 100 },
    { status: 201 },
  )
}
