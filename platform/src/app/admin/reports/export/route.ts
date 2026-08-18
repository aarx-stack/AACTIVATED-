import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { affiliateReport } from '@/lib/reports'

export async function GET(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return new NextResponse('Unauthorized', { status: 401 })
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30)
  const rows = await affiliateReport(session.user.organizationId, new Date(Date.now() - days * 86_400_000), new Date())

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const csv = [
    ['Affiliate ID', 'Name', 'Clicks', 'Orders', 'CVR %', 'EPC', 'AOV', 'Revenue', 'Commission'].join(','),
    ...rows.map(r =>
      [r.affiliate_id, esc(r.name), r.clicks, r.orders, r.conversion_rate, r.epc, r.aov, r.revenue, r.commission].join(','),
    ),
  ].join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="affiliate-report-${days}d.csv"`,
    },
  })
}
