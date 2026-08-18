import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApi, parsePagination } from '@/lib/api-auth'

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
    db.commission.findMany({
      where, skip, take,
      orderBy: { createdAt: 'desc' },
      include: {
        affiliate: { select: { affiliateCode: true } },
        conversion: { include: { order: { select: { externalOrderId: true } } } },
      },
    }),
    db.commission.count({ where }),
  ])
  return NextResponse.json({
    data: rows.map(c => ({
      id: c.id,
      affiliate_id: c.affiliate.affiliateCode,
      order_id: c.conversion.order.externalOrderId,
      type: c.type,
      level: c.overrideLevel,
      amount: c.amountCents / 100,
      reversed: c.reversedCents / 100,
      status: c.status,
      created_at: c.createdAt,
    })),
    pagination: { page, per_page: perPage, total },
  })
}
