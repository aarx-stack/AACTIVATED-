# Acquisition Readiness

Long-term strategy: AACTIVATED RX is **Organization/Tenant #1** of a
multi-company enterprise platform. The Phase 3 Data Core is built so future
external organizations run on the same infrastructure with **zero architectural
change** — a new tenant is data (`organizations` row + settings + mappings),
not a fork.

## Why this architecture is diligence-friendly

- **Single source of financial truth** with exact decimal arithmetic,
  append-only ledgers, effective-dated costs, and per-order P&L — historical
  numbers are reproducible and never silently rewritten.
- **Idempotent ingestion + automation events** make the pipeline's behavior
  provable from the database itself.
- **Audit log** (actor, before/after, reason) covers significant changes.
- **Reproducible from GitHub**: schema = migrations, config = seeds; the
  entire database structure can be rebuilt and inspected by a third party.

## SaaS / enterprise metrics — definitions only

These are **not tracked yet and no values are asserted**. The schema already
contains the inputs; each metric below is defined so the future Command Center
computes them consistently. Periods default to calendar months (UTC).

| Metric | Definition (from Data Core tables) |
| --- | --- |
| GMV | Σ `orders.gross_revenue` for the period (per org / platform) |
| Transaction volume | count of `orders` (and Σ `order_items.quantity`) for the period |
| Net revenue | Σ `orders.net_revenue` |
| Gross margin | Σ `order_financials.gross_profit` ÷ Σ `net_revenue` |
| Net margin | Σ `order_financials.net_profit` ÷ Σ `net_revenue` |
| Commission volume | Σ `commissions.commission_amount` (net of REVERSAL rows) for the period |
| Customer count | distinct `orders.customer_reference` with ≥1 paid order in period |
| Customer concentration | top-N customers' share of net revenue (per `customer_reference`) |
| Churn (customer) | customers active in period P−1 with no paid order in P ÷ customers active in P−1 |
| MRR | when subscription products exist: Σ normalized monthly value of active subscriptions; until then not applicable — do not approximate from one-off orders |
| ARR | MRR × 12 (same caveat) |
| NRR (net revenue retention) | net revenue in P from customers who were customers in P−1 ÷ their net revenue in P−1 |
| Automation success rate | `automation_events` with status SUCCESS ÷ (SUCCESS + FAILED) per event_type per period |

Platform-level (multi-tenant) versions aggregate across `organization_id`;
tenant-level filter on it. **Do not fabricate values** — these fields populate
only from real ingested data.

## IP ownership considerations

- Code, schema, and documentation in this repository are proprietary work
  product of AACTIVATED; keep authorship history clean (this repo) and ensure
  any contractor work is under IP-assignment terms.
- Third-party SaaS (Sellavi, Tapfiliate, Vercel, future DB provider) is
  licensed, not owned — the Data Core exists precisely so the **data asset**
  (orders, ledger, history) is ours and portable.
- No GPL-family copyleft in the runtime path (dependency: `pg` — MIT).

## Third-party dependency inventory

| Dependency | Type | Role | Exit strategy |
| --- | --- | --- | --- |
| Sellavi | SaaS | Commerce | Orders mirrored here; ingestion source is swappable (`orders.source`) |
| Tapfiliate | SaaS | Affiliate/MLM ops | Conversions/commissions mirrored as ledger; external ids retained |
| Vercel | PaaS | Serverless runtime | Stateless glue; portable Node code |
| PostgreSQL (managed, TBD) | Infra | Data Core storage | Standard PostgreSQL — dump/restore to any provider |
| npm `pg` (MIT) | Library | DB driver | Commodity, replaceable |
| Node.js ≥ 20 | Runtime | Tooling/services | Commodity |

## Data portability

Plain PostgreSQL + plain SQL migrations: `pg_dump` restores anywhere.
External-system ids (`external_*` columns) are preserved on every mirrored
record, so history remains joinable to (or re-exportable from) the SaaS
systems. No proprietary extensions beyond `pgcrypto`/`btree_gist` (available
on all major providers).

## Auditability

- `audit_log` — who/what/when/before/after/why.
- `automation_events` — every machine action, idempotent, replay-safe.
- `schema_migrations` checksums — schema history is tamper-evident.
- Append-only correction model — no destructive edits to financial history.

## Security controls

See [SECURITY.md](./SECURITY.md): no card/bank/credential storage, payload
redaction, org-scoped constraints, least-privilege DB roles, RLS upgrade path,
TLS, secret-manager-only credentials.

## Backup strategy & disaster recovery

- Schema + config: reproducible from GitHub at any commit.
- Data: provider automated daily snapshots + point-in-time recovery, enabled
  at provisioning; restore drill documented in [RUNBOOK.md](./RUNBOOK.md).
- RPO target: ≤ 24h from snapshots, near-zero with PITR; RTO target: hours
  (managed-provider restore + `DATABASE_URL` swap). Formalize when production
  is provisioned.

## Enterprise readiness roadmap

1. Provision production PostgreSQL (approved provider) — pending review.
2. Wire Phase 1/2 Vercel handlers to ingestion functions; backfill history.
3. Authentication + RBAC enforcement on the existing role substrate.
4. Row-level security before any second real tenant.
5. Command Center (dashboards) reading the metric definitions above.
6. Payout provider integration (explicit approval; Zelle stays manual).
