# Partner Platform — Affiliate, Rep & Commission Tracking

A self-hosted affiliate / rep / distributor tracking and commission engine
inspired by the functionality of Everflow and TUNE. It is the central
tracking and commission system for an e-commerce business: storefronts push
orders in via webhooks or REST API, and the platform handles attribution,
commissions, multi-level team overrides, an immutable ledger, refund
reversals, weekly payouts, fraud flagging, and reporting.

## Tech stack

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS
- **PostgreSQL** + **Prisma 7** (driver adapter: `@prisma/adapter-pg`)
- **Auth.js (NextAuth v5)** credentials auth with server-side RBAC
- **Recharts** for dashboards, **Zod** for validation, **Vitest** for tests
- All money is stored as **integer cents** — no floating point anywhere in
  financial code paths.

## Local installation

```bash
cd platform
npm install

# 1. Configure environment
cp .env.example .env         # then fill in DATABASE_URL etc.

# 2. Create the database schema
npx prisma migrate dev

# 3. Seed demo data (1 admin, 1 distributor, 5 reps, 100 clicks, 20 orders,
#    plans, promo codes, a refund, and a paid payout batch)
npm run db:seed

# 4. Run
npm run dev                  # http://localhost:3000
```

### Demo logins (after seeding)

| Role | Email | Password |
|---|---|---|
| Super admin | `admin@example.com` | `admin1234` |
| Distributor | `dana@example.com` | `partner1234` |
| Rep | `riley@example.com` / `jordan@example.com` | `partner1234` |

Admins land on `/admin`, affiliates on `/portal`.

## Creating your first admin (without seed data)

```bash
npx tsx -e "
import bcrypt from 'bcryptjs'
import { db } from './src/lib/db'
const org = await db.organization.create({ data: { name: 'My Company', slug: 'my-company' } })
await db.user.create({ data: {
  organizationId: org.id, email: 'you@company.com', name: 'You',
  role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash('choose-a-password', 10),
}})
await db.\$disconnect()
"
```

## Generating API keys

Admin → **API Keys** → Generate. Choose `LIVE` (`live_sk_…`) or `TEST`
(`test_sk_…`) mode and per-key permissions (`conversion:write`,
`affiliate:read`, …). **The secret is displayed exactly once** — only its
SHA-256 hash is stored.

## Connecting a storefront

Point your storefront's order webhook at:

```
POST {APP_URL}/api/v1/conversions
```

Authenticate one of two ways:

1. **API key** — header `X-API-Key: live_sk_…` (key needs `conversion:write`)
2. **HMAC signature** — headers `X-Webhook-Timestamp: <unix seconds>` and
   `X-Webhook-Signature: hex(hmac_sha256(secret, "<timestamp>.<raw body>"))`.
   The secret is `WEBHOOK_SECRET` or the per-org secret in Settings.
   Timestamps older than 5 minutes are rejected (replay protection).

Optionally send `X-Idempotency-Key` — repeated deliveries with the same key
short-circuit. Duplicate `order_id`s are also deduplicated.

### Testing a webhook

```bash
curl -X POST http://localhost:3000/api/v1/conversions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test_sk_..." \
  -H "X-Idempotency-Key: order-12345-attempt-1" \
  -d '{
    "event": "order.completed",
    "order_id": "ORDER-12345",
    "customer_email": "customer@example.com",
    "subtotal": 199.97, "discount": 20.00, "shipping": 10.00,
    "tax": 15.50, "total": 205.47, "currency": "USD",
    "promo_code": "SAVE20",
    "click_id": "clk_8f29dj2",
    "products": [{"sku": "PRODUCT-001", "name": "Product", "quantity": 1, "unit_price": 199.97}]
  }'
```

Refunds: `POST /api/v1/webhooks/refund` (or send `order.refunded` /
`order.partially_refunded` / `order.cancelled` / `chargeback.created` events
to `/api/v1/conversions`). Partial refunds reverse commissions
proportionally with balancing ledger entries.

Storefront-specific payloads (Shopify, WooCommerce, Sellavi) go through the
adapter endpoint: `POST /api/integrations/commerce/orders?adapter=shopify`.
Adding a storefront means adding one adapter in `src/lib/adapters.ts`.

### Tracking links

Every affiliate gets `{APP_URL}/r/<referralCode>`. The redirect records a
click (IP, UA, device, UTM…), issues a `clk_…` click id, sets attribution
cookies, and forwards to the destination with `?ref=<code>&click_id=clk_…`
appended — pass those through checkout into the order webhook.

## Commission configuration

- **Plans** (`CommissionPlan` + `CommissionRule`): percentage, flat
  per-order, product-specific (% or flat), and tiered-by-monthly-volume
  rules. Assign a plan per affiliate; `recurring` controls whether repeat
  purchases keep paying the originating affiliate.
- **Commissionable revenue basis** (Settings): gross total, subtotal,
  subtotal after discounts (default), total ex-tax, total ex-shipping, or
  profit/margin.
- **Team overrides** (Settings): per-level percentages (e.g. L1 5%, L2 3%,
  L3 2%) paid up the upline chain. Circular relationships are rejected.
- **Attribution** (Settings): priority order over explicit affiliate id →
  click id → promo code → customer ownership → cookie window
  (1/7/14/30/60/90 days or lifetime).

## Payout configuration

Approved commissions become payable in the next weekly batch (default:
Friday — configurable in Settings). Admin → Payouts → **Generate batch**
groups eligible commissions per affiliate; mark each payout
Pending/Processing/Paid/Failed and export CSV. Marking Paid writes the
`PAYOUT` ledger debit. Money movement itself is manual in the MVP.

## Running tests

```bash
npm test          # unit + integration (integration tests need DATABASE_URL)
npx tsc --noEmit  # type check
npm run lint
```

## Deploying

- **Vercel** (or any Node host) for the app; set all env vars from
  `.env.example`.
- **Managed Postgres** (Neon / Supabase / RDS). Run
  `npx prisma migrate deploy` on release.
- Multi-tenancy is built in: every core record carries `organizationId`,
  so additional businesses can be added without schema changes.

## API documentation

Human-readable docs are served at `/docs`; the OpenAPI 3.1 spec is at
`/openapi.json` (also in `public/openapi.json`).
