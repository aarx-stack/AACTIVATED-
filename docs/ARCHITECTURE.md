# AACTIVATED Platform Architecture

Phase 3 — Data Core / Enterprise Foundation. Status: **designed and tested; no
production database provisioned yet** (pending review, see
[RUNBOOK.md](./RUNBOOK.md)).

## System flow

```
Customer click (affiliate referral link)
        │
        ▼
   ┌─────────┐     webhooks /      ┌──────────────────┐    postbacks    ┌────────────┐
   │ SELLAVI │ ──── order data ──▶ │  VERCEL BACKEND  │ ──────────────▶ │ TAPFILIATE │
   │commerce │                     │ (Phase 1/2 glue) │ ◀── webhooks ── │ affiliate/ │
   └─────────┘                     └────────┬─────────┘                 │ commission │
                                            │ idempotent ingestion     └────────────┘
                                            ▼
                                   ┌────────────────┐
                                   │   DATA CORE    │  PostgreSQL (this repo:
                                   │  (Phase 3)     │  /data-core migrations,
                                   │ permanent      │  ingestion, financials)
                                   │ history + $$$  │
                                   └────────┬───────┘
                                            │ read-only queries
                                            ▼
                                   ┌────────────────┐
                                   │ COMMAND CENTER │  future dashboards /
                                   │  (future)      │  management layer
                                   └────────────────┘
```

## Responsibilities — who is the source of truth for what

| Layer | Role | Source of truth for |
| --- | --- | --- |
| **GitHub** | Source code and version history | Schema (migrations), business-rule code, docs |
| **Vercel** | Runtime / serverless infrastructure | Nothing durable — stateless glue executing webhook logic |
| **Sellavi** | Commerce system | Live checkout, cart, payment capture |
| **Tapfiliate** | Affiliate / commission system (operational) | Live referral tracking, MLM evaluation (L2 = 3%, L3 = 2%), commission approval workflow |
| **Data Core** | Permanent consolidated operational history | Orders + COGS snapshots, commission ledger, payouts, financials, automation events, audit log |
| **Command Center** | Future visualization / management layer | Nothing — reads the Data Core |

The Data Core mirrors and consolidates; it does **not** replace Sellavi or
Tapfiliate (Phase 1/2 stay untouched). Over time it becomes the system the
business trusts for money questions, because it is the only layer that keeps
exact, effective-dated history under our own control.

## Phases

- **Phase 1 (live):** personal affiliate tier automation (Vercel + Tapfiliate).
- **Phase 2 (live):** team/MLM override infrastructure; Tapfiliate native MLM
  pays selling-affiliate personal rate + 3% level 2 + 2% level 3. End-to-end
  test verified: referral click → Sellavi order → Tapfiliate conversion →
  correct order value → personal + L2 + L3 commissions.
- **Phase 3 (this):** the Data Core — multi-tenant PostgreSQL schema,
  migrations, exact-decimal financial engine, idempotent ingestion, tests,
  documentation. No production writes yet.
- **Future:** Command Center dashboard, payout-provider integration (requires
  approval), RBAC/auth, additional tenants.

## Multi-tenant design

Every business-owned operational table carries `organization_id`. AACTIVATED RX
is simply **tenant #1** (`organization_key = 'AACTIVATED_RX'`), created by a
seed — nothing AACTIVATED-specific is baked into the schema, constraints, or
code. Rates (logistics 15%, cost tier BULK, merchant fees) live in
`organization_settings` rows, not in code. A future company onboards by
inserting an `organizations` row + settings and mapping its external systems —
no schema change. Isolation is enforced today by org-scoped unique constraints
and org-scoped queries; PostgreSQL row-level security can be layered on later
without redesign (see [SECURITY.md](./SECURITY.md)).

## Repository layout (this branch)

| Path | Contents |
| --- | --- |
| `/data-core` | Phase 3: migrations, seeds, ingestion/services, financial engine, tests |
| `/docs` | This documentation set |
| `/index.html`, `/main.js`, `/styles.css`, `/assets` | Pre-existing static marketing site (deployed by `.github/workflows/deploy-pages.yml` from its own branch — untouched by Phase 3) |

## Branch inventory (unmerged sibling work — none modified by Phase 3)

| Branch | Contents |
| --- | --- |
| `claude/tapfiliate-tier-webhook-ky3901` | **Phase 1 Vercel backend**: `api/tapfiliate-webhook.js` + `_lib` (tier ladder Standard 15% → Elite 35%, protected-group keywords, integer-cents math, Upstash Redis / Vercel KV idempotency). No persistent database — KV is a TTL dedup cache, which is exactly the gap the Data Core fills. |
| `claude/affiliate-tracking-platform-tkkohy` | In-house affiliate platform **prototype** (Next.js + Prisma + PostgreSQL, own auth/offers/fraud models). A potential future Tapfiliate replacement — out of Phase 3 scope, deliberately untouched (see the Phase 3 report's database-technology evaluation). |
| `claude/3d-scrolling-website-s09aix` | Static marketing site (base of this branch) |
| `claude/credit-repair-website-h6akpr` | Unrelated website experiment |

When the Phase 1/2 Vercel backend adopts the Data Core, it imports the
`/data-core` ingestion functions (see [INTEGRATIONS.md](./INTEGRATIONS.md));
its Redis/KV dedup can then retire in favor of database-level idempotency.
