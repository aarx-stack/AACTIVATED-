import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { getSetting } from '@/lib/settings'
import { createApiKeyAction, dismissApiKeyReveal, revokeApiKey } from '../actions'
import { Card, CardHeader, Table, Td, EmptyRow, PageHeader, Badge, inputClass, buttonClass, buttonSmallClass } from '@/components/ui'
import { CopyButton } from '@/components/copy-button'

const PERMISSIONS = [
  'affiliate:read', 'affiliate:write',
  'conversion:read', 'conversion:write',
  'report:read', 'payout:read', 'payout:write',
]

export default async function ApiKeysPage() {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId
  const keys = await db.apiKey.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } })

  const reveals = new Map<string, string>()
  for (const k of keys) {
    const v = await getSetting(orgId, `apikey.reveal.${k.id}`)
    if (v) reveals.set(k.id, v)
  }

  return (
    <div>
      <PageHeader title="API Keys" subtitle="Authenticate storefront webhooks and REST API calls" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Generate key" subtitle="The secret is shown exactly once" />
          <form action={createApiKeyAction} className="space-y-3 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Name</label>
              <input name="name" required placeholder="Storefront webhook" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Mode</label>
              <select name="mode" className={inputClass}>
                <option value="LIVE">Live (live_sk_...)</option>
                <option value="TEST">Test (test_sk_...)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Permissions</label>
              <div className="space-y-1">
                {PERMISSIONS.map(p => (
                  <label key={p} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="permissions" value={p} defaultChecked={p === 'conversion:write'} />
                    <span className="font-mono">{p}</span>
                  </label>
                ))}
              </div>
            </div>
            <button className={`${buttonClass} w-full`}>Generate</button>
          </form>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Keys" />
          <Table headers={['Name', 'Key', 'Mode', 'Permissions', 'Last used', 'Status', 'Actions']}>
            {keys.length === 0 && <EmptyRow cols={7} message="No API keys yet" />}
            {keys.map(k => (
              <tr key={k.id}>
                <Td className="font-medium">{k.name}</Td>
                <Td>
                  {reveals.has(k.id) ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-amber-700 dark:text-amber-400">{reveals.get(k.id)}</span>
                      <CopyButton text={reveals.get(k.id)!} />
                      <form action={dismissApiKeyReveal.bind(null, k.id)}>
                        <button className={buttonSmallClass}>Hide</button>
                      </form>
                    </div>
                  ) : (
                    <span className="font-mono text-xs text-zinc-400">{k.prefix}…</span>
                  )}
                </Td>
                <Td>{k.mode}</Td>
                <Td className="max-w-48 truncate font-mono text-[10px]">{k.permissions}</Td>
                <Td className="text-xs text-zinc-400">{k.lastUsedAt?.toISOString().slice(0, 10) ?? 'never'}</Td>
                <Td><Badge status={k.revokedAt ? 'REJECTED' : 'ACTIVE'} /></Td>
                <Td>
                  {!k.revokedAt && (
                    <form action={revokeApiKey.bind(null, k.id)}>
                      <button className={buttonSmallClass}>Revoke</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
