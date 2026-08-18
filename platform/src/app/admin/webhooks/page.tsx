import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { getSetting } from '@/lib/settings'
import { createWebhookEndpoint, dismissWebhookSecretReveal, retryWebhookDelivery, sendSampleWebhook } from '../actions'
import { Card, CardHeader, Table, Td, EmptyRow, PageHeader, Badge, inputClass, buttonClass, buttonSecondaryClass, buttonSmallClass } from '@/components/ui'
import { CopyButton } from '@/components/copy-button'

export default async function WebhooksPage() {
  const session = (await requireAdmin())!
  const orgId = session.user.organizationId

  const [endpoints, deliveries, inbound] = await Promise.all([
    db.webhookEndpoint.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } }),
    db.webhookDelivery.findMany({
      where: { endpoint: { organizationId: orgId } },
      include: { endpoint: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db.webhookEvent.findMany({
      where: { organizationId: orgId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ])

  const reveals = new Map<string, string>()
  for (const ep of endpoints) {
    const v = await getSetting(orgId, `whsecret.reveal.${ep.id}`)
    if (v) reveals.set(ep.id, v)
  }

  return (
    <div>
      <PageHeader
        title="Webhooks"
        subtitle="Inbound event console and outbound destinations"
        action={
          <form action={sendSampleWebhook}>
            <button className={buttonSecondaryClass}>Send sample webhook</button>
          </form>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Add outbound endpoint" />
          <form action={createWebhookEndpoint} className="space-y-3 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Destination URL</label>
              <input name="url" type="url" required placeholder="https://example.com/webhooks" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Events (comma-separated, * for all)</label>
              <input name="events" defaultValue="*" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Description</label>
              <input name="description" className={inputClass} />
            </div>
            <button className={`${buttonClass} w-full`}>Create endpoint</button>
          </form>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Outbound endpoints" />
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {endpoints.length === 0 && <p className="px-5 py-8 text-center text-sm text-zinc-400">No endpoints configured</p>}
            {endpoints.map(ep => (
              <div key={ep.id} className="px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs">{ep.url}</p>
                  <Badge status={ep.isActive ? 'ACTIVE' : 'HELD'} />
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">Events: {ep.events}</p>
                {reveals.has(ep.id) && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950">
                    <p className="font-mono text-xs text-amber-800 dark:text-amber-300">{reveals.get(ep.id)}</p>
                    <CopyButton text={reveals.get(ep.id)!} label="Copy secret" />
                    <form action={dismissWebhookSecretReveal.bind(null, ep.id)}>
                      <button className={buttonSmallClass}>Dismiss (shown once)</button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Outbound deliveries" subtitle="Automatic retries with exponential backoff" />
          <Table headers={['Event', 'Endpoint', 'Attempts', 'HTTP', 'Status', 'Actions']}>
            {deliveries.length === 0 && <EmptyRow cols={6} message="No deliveries yet" />}
            {deliveries.map(d => (
              <tr key={d.id}>
                <Td className="font-mono text-xs">{d.eventType}</Td>
                <Td className="max-w-56 truncate font-mono text-xs">{d.endpoint.url}</Td>
                <Td>{d.attempts}</Td>
                <Td>{d.lastStatus ?? '—'}</Td>
                <Td><Badge status={d.status} /></Td>
                <Td>
                  {d.status !== 'DELIVERED' && (
                    <form action={retryWebhookDelivery.bind(null, d.id)}>
                      <button className={buttonSmallClass}>Retry</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Inbound webhook log" subtitle="Raw storefront events received by the platform" />
          <Table headers={['Time', 'Source', 'Event', 'Signature', 'HTTP', 'Error', 'Payload']}>
            {inbound.length === 0 && <EmptyRow cols={7} message="No inbound webhooks logged yet" />}
            {inbound.map(e => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-xs text-zinc-400">{e.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>{e.source}</Td>
                <Td className="font-mono text-xs">{e.eventType}</Td>
                <Td>{e.signatureValid === null ? 'API key' : e.signatureValid ? 'valid' : 'invalid'}</Td>
                <Td>{e.httpStatus}</Td>
                <Td className="max-w-40 truncate text-xs text-red-600">{e.error ?? '—'}</Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-xs text-indigo-600">view</summary>
                    <pre className="mt-1 max-h-48 max-w-md overflow-auto rounded bg-zinc-100 p-2 text-[10px] dark:bg-zinc-800">
                      {e.rawPayload.slice(0, 3000)}
                    </pre>
                  </details>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  )
}
