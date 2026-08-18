// GET /api/v1/reports?type=affiliate|offer|product|financial&from=&to=
import { NextRequest, NextResponse } from 'next/server'
import { authenticateApi, apiError } from '@/lib/api-auth'
import { affiliateReport, financialReport, productReport } from '@/lib/reports'

export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, 'report:read')
  if ('error' in auth) return auth.error
  const sp = req.nextUrl.searchParams
  const type = sp.get('type') ?? 'financial'
  const from = sp.get('from') ? new Date(sp.get('from')!) : new Date(Date.now() - 30 * 86_400_000)
  const to = sp.get('to') ? new Date(sp.get('to')!) : new Date()
  const orgId = auth.ctx.organizationId

  switch (type) {
    case 'affiliate':
      return NextResponse.json({ data: await affiliateReport(orgId, from, to) })
    case 'product':
      return NextResponse.json({ data: await productReport(orgId, from, to) })
    case 'financial':
      return NextResponse.json({ data: await financialReport(orgId, from, to) })
    default:
      return apiError(422, 'invalid_report_type', 'type must be affiliate, product, or financial')
  }
}
