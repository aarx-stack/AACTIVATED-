# Data Model

PostgreSQL schema, defined by the migrations in `/data-core/migrations`
(forward-only, checksummed, reproducible from GitHub). All money columns are
`numeric(18,6)`; rates are `numeric(9,6)`; **no floating-point column holds
money anywhere**. All primary keys are UUIDs. Every business-owned operational
table carries `organization_id → organizations(id)`.

## Entity groups and relationships

```
organizations ─┬─ organization_settings (1:1)
               ├─ organization_users ─── users (global identity)
               ├─ products ──┬─ product_costs ── suppliers
               │             │      (effective-dated windows)
               ├─ orders ────┴─ order_items (cost snapshots)
               │      │
               │      ├─ order_financials (1:1 per order)
               │      └─ conversions ── commissions (ledger) ── payout_items ── payouts
               ├─ affiliates ─┬─ affiliate_relationships (effective-dated sponsor tree)
               │              ├─ conversions / commissions / payouts (as owner)
               ├─ automation_events
               └─ audit_log
```

## Tables

### organizations (migration 0002)
Tenant root. `organization_key` (unique, e.g. `AACTIVATED_RX`), `name`,
`status` (ACTIVE/SUSPENDED/ARCHIVED), timestamps.

### users / organization_users (0002)
Global identity (`users`: unique lower(email), `external_auth_id` for a future
IdP — **no password columns**; auth is future work) and org membership with
role: `owner | admin | finance | operations | affiliate_manager | marketing |
viewer`. Unique `(organization_id, user_id)`. The shape supports RBAC later
without migration churn.

### organization_settings (0002)
Per-tenant configuration — never code constants: `default_currency`,
`logistics_rate` (default **0.150000** = shipping + labor + storage),
`default_cost_tier` (**BULK**), `merchant_fee_percentage` / `merchant_fee_fixed`
(**NULL = NOT_CONFIGURED**; no invented fees). One row per org.

### products (0003)
Product master. Identified by internal id + org-scoped `sku` (unique per org) —
never by name alone. `product_name`, `strength` (e.g. `10mg`, `5mg/5mg`),
`unit_type` (VIAL), `active`, and external mappings
`external_sellavi_product_id` (unique per org when present) + `external_sku`.

### suppliers (0003)
`supplier_key` unique per org (seeded: `WHOLESALE_PEPTIDE_SUPPLY`), name, status.

### product_costs (0003) — the cost engine
One row = one supplier price **window** for one product:
`small_kit_cost` / `bulk_kit_cost` (list price per kit), `vials_per_kit`
(10 today), `active_cost_tier` (SMALL/BULK), optional `logistics_rate` override
(NULL → org default), `effective_from` / `effective_to` (NULL = current),
`source_reference` (e.g. the wholesale PDF), and
`cost_status ∈ {PRICED, PRICE_NEEDED}` — missing supplier prices are stored
explicitly, never invented (`PRICE_NEEDED` rows have NULL costs; a CHECK forces
a PRICED row to carry a price for its active tier).

Integrity: a GiST **exclusion constraint** forbids overlapping windows per
(product, supplier); windows are closed, never deleted, so historical orders
keep their cost context forever. Derived per-vial numbers are computed in
`src/costing.js` and snapshotted onto order items — see
[FINANCIAL_MODEL.md](./FINANCIAL_MODEL.md).

### orders / order_items (0004)
Orders: `external_order_id` + `source` (SELLAVI/MANUAL/OTHER) unique per org —
the Sellavi idempotency key (e.g. `SELLAVI-4852`). Monetary rollups
(`subtotal`, `discount_total`, `gross_revenue`, `refund_total`, `net_revenue`),
`order_status`, `financial_status`, `ordered_at`, `customer_reference`
(external reference only — no card data, see [SECURITY.md](./SECURITY.md)).

Items: unique `(order_id, line_number)` for idempotent line replay; nullable
`product_id` (unmapped external products still land, keeping
`external_product_id`/`sku` for reconciliation); `quantity`, `unit_sale_price`,
`line_revenue`; and the **frozen COGS snapshot**: `unit_base_cost_snapshot`,
`unit_landed_cost_snapshot`, `line_cogs`, `product_cost_id` (provenance),
`cost_snapshot_status ∈ {SNAPSHOTTED, PRICE_NEEDED}` (a CHECK keeps status and
values consistent). Replays refresh quantities/prices but never overwrite an
existing snapshot.

### affiliates / affiliate_relationships (0005)
Affiliates mirror Tapfiliate: `external_tapfiliate_id` and
`external_referral_code` (each unique per org when present), `name`, `email`,
`affiliate_group`, `partner_type`, **`protected_group`** (never moved by
automation — Phase 2 rule), `team_builder`, `status`.

Relationships are effective-dated sponsor edges (`affiliate_id`,
`parent_affiliate_id`, `relationship_type`, `effective_from/to`) with an
exclusion constraint: at most one open edge per type per affiliate. Sponsor
changes close the old edge and open a new one — historical MLM trees are
always reconstructible.

### conversions (0006)
Tapfiliate conversions: `external_conversion_id` **unique per org**,
link to `order_id` and `affiliate_id`, `conversion_amount`, `currency`,
`status ∈ {pending, approved, disapproved}`, `source`, `converted_at`.

### commissions (0006) — the ledger
One row per commission event, never a collapsed total.
`commission_type ∈ {DIRECT, MLM_LEVEL_2, MLM_LEVEL_3, BONUS,
MANUAL_ADJUSTMENT, REVERSAL}`, `commission_rate`, `commission_amount`
(REVERSAL ≤ 0, earning types ≥ 0, MANUAL_ADJUSTMENT either — CHECK-enforced),
`status ∈ {pending, approved, disapproved, payable, paid, reversed}`,
`external_commission_id` (unique per org when present),
`reversed_commission_id` (REVERSAL rows must link; unique — one reversal per
commission), `approved_at`, `paid_at`.

Duplicate protection: unique `(org, conversion, affiliate, type)` for
DIRECT/MLM rows + unique external id. See
[COMMISSION_RULES.md](./COMMISSION_RULES.md).

### payouts / payout_items (0007)
Provider-neutral payouts: `payout_method ∈ {ACH, BANK_TRANSFER, PAYPAL, ZELLE,
OTHER}`, `automation_capability ∈ {MANUAL_ONLY, PROVIDER_AUTOMATED}` (Zelle is
always MANUAL_ONLY — no supported API; the automatable-provider allowlist in
code is empty pending approval), `provider`, `external_payout_id` (unique per
org when present — never bank credentials), `total_amount`, `status`
(DRAFT→PENDING→PROCESSING→SETTLED / FAILED / CANCELLED), `settled_at`.

`payout_items` links commissions to payouts with **unique `commission_id`** —
a commission can be paid at most once, enforced by the database. Releasing a
failed/cancelled payout is an explicit audited operation.

### order_financials (0008)
One row per order (unique `order_id`): `gross_revenue`, `discounts`,
`net_revenue`, `product_cogs` (landed), `logistics_cost` (display-only share
inside COGS), `merchant_processing_fee` (NULL until configured) +
`merchant_fee_status`, `direct_affiliate_commission`, `mlm_commission`,
`total_affiliate_expense`, `refunds`, `gross_profit`, `net_profit`,
`net_margin`, `cogs_status ∈ {COMPLETE, PARTIAL_PRICE_NEEDED}`,
`calculation_version`. Formulas in [FINANCIAL_MODEL.md](./FINANCIAL_MODEL.md).

### automation_events (0009)
Machine activity history: `event_type` (WEBHOOK_RECEIVED,
CONVERSION_PROCESSED, AFFILIATE_TIER_EVALUATED, AFFILIATE_GROUP_CHANGED,
PROTECTED_GROUP_SKIPPED, MLM_EVALUATED, ORDER_IMPORTED, FINANCIAL_CALCULATED,
PAYOUT_CREATED, PAYOUT_SETTLED, ERROR, OTHER), `source_system`,
`external_event_id` (unique per org+source when present — webhook replay
dedup), `entity_type`/`entity_id`, `status`, `payload_json` (secret-redacted),
`occurred_at`.

### audit_log (0009)
Append-only change history for diligence: `actor_type` (USER/SYSTEM/
INTEGRATION), `actor_id`, `action`, `entity_type`/`entity_id`,
`before_json`/`after_json` (redacted), `reason`, `created_at`.

### schema_migrations (created by the runner)
`version`, sha256 `checksum`, `applied_at` — edited-after-apply migrations fail
loudly.

## Key idempotency constraints (summary)

| Table | Organization-scoped unique key |
| --- | --- |
| orders | `(organization_id, source, external_order_id)` |
| order_items | `(order_id, line_number)` |
| conversions | `(organization_id, external_conversion_id)` |
| commissions | `(organization_id, external_commission_id)` and `(organization_id, conversion_id, affiliate_id, commission_type)` for DIRECT/MLM |
| commissions (reversal) | `reversed_commission_id` unique |
| payouts | `(organization_id, external_payout_id)` |
| payout_items | `commission_id` unique (no double pay) |
| automation_events | `(organization_id, source_system, external_event_id)` |
| products | `(organization_id, sku)`, `(organization_id, external_sellavi_product_id)` |
| product_costs | no-overlap exclusion per (product, supplier) |
