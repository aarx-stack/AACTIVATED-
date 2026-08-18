import { Card, CardHeader } from '@/components/ui'

interface Endpoint {
  method: string
  path: string
  auth: string
  description: string
  example?: string
  response?: string
}

const endpoints: Endpoint[] = [
  {
    method: 'POST',
    path: '/api/v1/conversions',
    auth: 'X-API-Key (conversion:write) or HMAC signature',
    description:
      'Order/conversion webhook ingestion. Deduplicates by order_id, supports X-Idempotency-Key, runs attribution → commission → overrides → ledger. Send refund events (order.refunded, order.partially_refunded, order.cancelled, chargeback.created) here too.',
    example: `curl -X POST $APP_URL/api/v1/conversions \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: live_sk_..." \\
  -H "X-Idempotency-Key: order-12345-1" \\
  -d '{
  "event": "order.completed",
  "order_id": "ORDER-12345",
  "customer_email": "customer@example.com",
  "subtotal": 199.97, "discount": 20.00,
  "shipping": 10.00, "tax": 15.50, "total": 205.47,
  "currency": "USD", "promo_code": "SAVE20",
  "click_id": "clk_8f29dj2",
  "products": [{"sku":"PRODUCT-001","name":"Product","quantity":1,"unit_price":199.97}]
}'`,
    response: `{
  "ok": true, "duplicate": false,
  "conversion_id": "…", "affiliate_id": "AFF-XXXXXX",
  "attribution": "CLICK_ID",
  "commission": 53.99, "overrides": 14.40
}`,
  },
  {
    method: 'POST',
    path: '/api/v1/webhooks/refund',
    auth: 'X-API-Key (conversion:write) or HMAC signature',
    description: 'Reverse commissions for a refund/chargeback. Omit refund_amount for a full refund; include it (in dollars) for proportional partial reversal.',
    example: `{"event":"order.refunded","order_id":"ORDER-12345","refund_amount": 50.00}`,
    response: `{"ok": true, "reversed_commission": 17.10}`,
  },
  {
    method: 'POST',
    path: '/api/integrations/commerce/orders?adapter=shopify|woocommerce|sellavi|custom',
    auth: 'X-API-Key or HMAC signature',
    description: 'Adapter-based ingestion: send the storefront-native payload and the named adapter maps it to the internal normalized order before the same pipeline runs.',
  },
  {
    method: 'GET',
    path: '/api/v1/conversions?status=&page=&per_page=',
    auth: 'X-API-Key (conversion:read)',
    description: 'Paginated conversion listing with status filtering.',
  },
  {
    method: 'GET / POST',
    path: '/api/v1/affiliates',
    auth: 'X-API-Key (affiliate:read / affiliate:write)',
    description: 'List or create affiliates. Creation returns the tracking URL and referral code.',
  },
  {
    method: 'GET / PATCH',
    path: '/api/v1/affiliates/:id',
    auth: 'X-API-Key (affiliate:read / affiliate:write)',
    description: 'Fetch (with revenue stats) or update one affiliate by id, affiliate code, or referral code.',
  },
  {
    method: 'GET / POST',
    path: '/api/v1/clicks',
    auth: 'X-API-Key (conversion:read / conversion:write)',
    description: 'List clicks, or record a click server-side (returns a clk_… id). Most integrations use the /r/<code> redirect instead.',
  },
  { method: 'GET / POST', path: '/api/v1/offers', auth: 'X-API-Key (affiliate:read / affiliate:write)', description: 'List or create offers.' },
  { method: 'GET', path: '/api/v1/commissions', auth: 'X-API-Key (conversion:read)', description: 'Commission ledger entries (personal + overrides) with reversal amounts.' },
  { method: 'GET / POST', path: '/api/v1/payouts', auth: 'X-API-Key (payout:read / payout:write)', description: 'List payouts, or generate the next weekly batch from approved commissions.' },
  { method: 'GET', path: '/api/v1/reports?type=affiliate|product|financial&from=&to=', auth: 'X-API-Key (report:read)', description: 'Affiliate performance (clicks, CVR, EPC, AOV), product performance, or the financial summary.' },
  {
    method: 'GET',
    path: '/r/<referralCode-or-linkSlug>?url=<destination>',
    auth: 'Public',
    description: 'Tracking redirect. Records the click, sets attribution cookies, and redirects appending ?ref= and ?click_id= to the destination.',
  },
]

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">API Documentation</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Base URL: <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">/api/v1</code> · OpenAPI spec:{' '}
        <a href="/openapi.json" className="text-indigo-600">/openapi.json</a>
      </p>

      <Card className="mt-6">
        <CardHeader title="Authentication" />
        <div className="space-y-3 px-5 py-4 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            <strong>API keys:</strong> send <code>X-API-Key: live_sk_…</code> (or <code>test_sk_…</code>). Keys carry
            granular permissions (<code>conversion:write</code>, <code>affiliate:read</code>, …) and are stored hashed.
            Rate limit: 120 requests/minute per key (HTTP 429 above that).
          </p>
          <p>
            <strong>HMAC webhooks:</strong> alternatively sign requests with{' '}
            <code>X-Webhook-Timestamp</code> (unix seconds) and{' '}
            <code>X-Webhook-Signature = hex(hmac_sha256(secret, timestamp + &quot;.&quot; + rawBody))</code>. Timestamps
            older than 5 minutes are rejected (replay protection).
          </p>
          <p>
            <strong>Idempotency:</strong> send <code>X-Idempotency-Key</code> on webhook posts; replays return the
            original outcome without reprocessing.
          </p>
          <p>
            <strong>Errors</strong> use <code>{'{ "error": { "code", "message" } }'}</code> with conventional status
            codes: 401 unauthenticated, 403 missing permission, 404 not found, 422 validation, 429 rate limited.
          </p>
        </div>
      </Card>

      {endpoints.map(e => (
        <Card key={e.path + e.method} className="mt-4">
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                {e.method}
              </span>
              <code className="text-sm font-medium">{e.path}</code>
            </div>
            <p className="mt-1 text-xs text-zinc-400">Auth: {e.auth}</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{e.description}</p>
            {e.example && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">{e.example}</pre>
            )}
            {e.response && (
              <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-100 p-3 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{e.response}</pre>
            )}
          </div>
        </Card>
      ))}
    </main>
  )
}
