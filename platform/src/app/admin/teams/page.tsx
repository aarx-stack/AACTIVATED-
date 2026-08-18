import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { formatCents } from '@/lib/money'
import { Card, CardHeader, PageHeader } from '@/components/ui'

interface TreeNode {
  id: string
  name: string
  code: string
  type: string
  revenueCents: number
  children: TreeNode[]
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-2.5 text-sm dark:border-zinc-800" style={{ paddingLeft: `${20 + depth * 24}px` }}>
        <div>
          <Link href={`/admin/affiliates/${node.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
            {node.name}
          </Link>
          <span className="ml-2 text-xs text-zinc-400">{node.code} · {node.type}</span>
        </div>
        <span className="tabular-nums text-zinc-600 dark:text-zinc-300">{formatCents(node.revenueCents)}</span>
      </div>
      {node.children.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  )
}

export default async function TeamsPage() {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId

  const affiliates = await db.affiliate.findMany({
    where: { organizationId: orgId },
    select: { id: true, firstName: true, lastName: true, affiliateCode: true, type: true, parentId: true },
  })
  const revenue = await db.conversion.groupBy({
    by: ['affiliateId'],
    where: { organizationId: orgId, affiliateId: { not: null }, status: { notIn: ['REJECTED'] } },
    _sum: { revenueCents: true },
  })
  const revMap = new Map(revenue.map(r => [r.affiliateId!, r._sum.revenueCents ?? 0]))

  const nodes = new Map<string, TreeNode>(
    affiliates.map(a => [
      a.id,
      {
        id: a.id,
        name: `${a.firstName} ${a.lastName}`,
        code: a.affiliateCode,
        type: a.type,
        revenueCents: revMap.get(a.id) ?? 0,
        children: [] as TreeNode[],
      },
    ]),
  )
  const roots: TreeNode[] = []
  for (const a of affiliates) {
    const node = nodes.get(a.id)!
    if (a.parentId && nodes.has(a.parentId)) nodes.get(a.parentId)!.children.push(node)
    else roots.push(node)
  }

  return (
    <div>
      <PageHeader title="Teams" subtitle="Organization hierarchy — personal revenue per member" />
      <Card>
        <CardHeader title="Hierarchy" subtitle="Distributors → reps → downline" />
        {roots.length === 0 && <p className="px-5 py-10 text-center text-sm text-zinc-400">No affiliates yet</p>}
        {roots.map(r => (
          <TreeRow key={r.id} node={r} depth={0} />
        ))}
      </Card>
    </div>
  )
}
