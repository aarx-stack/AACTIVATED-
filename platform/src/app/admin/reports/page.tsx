import { requireAdmin } from '@/lib/auth'
import { affiliateReport, financialReport, productReport } from '@/lib/reports'
import { Card, CardHeader, Table, Td, EmptyRow, PageHeader, StatCard, buttonSecondaryClass } from '@/components/ui'

function reportRange(days: number): { from: Date; to: Date } {
  const to = new Date()
  return { from: new Date(to.getTime() - days * 86_400_000), to }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId
  const sp = await searchParams
  const days = Number(sp.days ?? 30)
  const { from, to } = reportRange(days)

  const [fin, affiliates, products] = await Promise.all([
    financialReport(orgId, from, to),
    affiliateReport(orgId, from, to),
    productReport(orgId, from, to),
  ])

  const fmt = (n: number) => `$${n.toFixed(2)}`

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`Last ${days} days`}
        action={
          <div className="flex gap-2">
            {[7, 30, 90].map(d => (
              <a key={d} href={`/admin/reports?days=${d}`} className={buttonSecondaryClass}>{d}d</a>
            ))}
            <a href={`/admin/reports/export?days=${days}`} className={buttonSecondaryClass}>Export CSV</a>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Gross revenue" value={fmt(fin.gross_revenue)} />
        <StatCard label="Refunds" value={fmt(fin.refunds)} sub={`${fin.refund_count} orders`} />
        <StatCard label="Net revenue" value={fmt(fin.net_revenue)} />
        <StatCard label="Net company revenue" value={fmt(fin.net_company_revenue)} sub="after commissions & overrides" />
        <StatCard label="Orders" value={String(fin.orders)} />
        <StatCard label="Discounts" value={fmt(fin.discounts)} />
        <StatCard label="Affiliate commissions" value={fmt(fin.affiliate_commissions)} />
        <StatCard label="Override commissions" value={fmt(fin.override_commissions)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Affiliate performance" />
          <Table headers={['Affiliate', 'Clicks', 'Orders', 'CVR', 'EPC', 'AOV', 'Revenue', 'Commission']}>
            {affiliates.length === 0 && <EmptyRow cols={8} message="No data" />}
            {affiliates.slice(0, 15).map(a => (
              <tr key={a.affiliate_id}>
                <Td>{a.name}</Td>
                <Td>{a.clicks}</Td>
                <Td>{a.orders}</Td>
                <Td>{a.conversion_rate}%</Td>
                <Td className="tabular-nums">${a.epc.toFixed(2)}</Td>
                <Td className="tabular-nums">${a.aov.toFixed(2)}</Td>
                <Td className="tabular-nums">${a.revenue.toFixed(2)}</Td>
                <Td className="tabular-nums">${a.commission.toFixed(2)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Product performance" />
          <Table headers={['SKU', 'Product', 'Units', 'Revenue']}>
            {products.length === 0 && <EmptyRow cols={4} message="No data" />}
            {products.slice(0, 15).map(p => (
              <tr key={p.sku}>
                <Td className="font-mono text-xs">{p.sku}</Td>
                <Td>{p.name}</Td>
                <Td>{p.units}</Td>
                <Td className="tabular-nums">${p.revenue.toFixed(2)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
