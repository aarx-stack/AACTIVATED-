import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { centsToDecimal } from '@/lib/money'

export async function GET() {
  const session = await requireAdmin()
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  const payouts = await db.payout.findMany({
    where: { organizationId: session.user.organizationId },
    include: { affiliate: true },
    orderBy: { createdAt: 'desc' },
  })

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = [
    ['Batch', 'Affiliate ID', 'Name', 'Email', 'Method', 'Amount', 'Status', 'Paid At'].join(','),
    ...payouts.map(p =>
      [
        p.batchKey,
        p.affiliate.affiliateCode,
        esc(`${p.affiliate.firstName} ${p.affiliate.lastName}`),
        p.affiliate.email,
        p.method ?? '',
        centsToDecimal(p.amountCents),
        p.status,
        p.paidAt?.toISOString() ?? '',
      ].join(','),
    ),
  ]
  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="payouts-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
