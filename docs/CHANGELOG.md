# Changelog

All notable platform changes. Dates are UTC.

## Phase 3 — Data Core / Enterprise Foundation (2026-08-24)

**Added** (no production database provisioned; no live writes — pending review)

- `/data-core` package: multi-tenant PostgreSQL schema as 9 forward-only,
  checksummed SQL migrations (`organizations`, `users`, `organization_users`,
  `organization_settings`, `products`, `suppliers`, `product_costs` with
  effective-dated no-overlap windows, `orders`, `order_items` with frozen COGS
  snapshots, `affiliates`, `affiliate_relationships`, `conversions`,
  `commissions` ledger, `payouts`, `payout_items`, `order_financials`,
  `automation_events`, `audit_log`).
- Exact-decimal money engine (BigInt micros, floats rejected), supplier cost
  engine (kit→vial, SMALL/BULK tiers, configurable 15% logistics), order
  financial calculator (double-count guards; merchant fees NOT_CONFIGURED by
  default).
- Idempotent ingestion for Sellavi orders and Tapfiliate
  affiliates/conversions/commissions; append-only reversals; protected-group
  guard; provider-neutral payouts (all MANUAL_ONLY; Zelle never auto-payable);
  automation events with secret redaction; audit log.
- Migration/seed runners; seed for tenant #1 (`AACTIVATED_RX`), supplier
  Wholesale Peptide Supply, Retatrutide 10mg costs (153.75 small / 129.15 bulk
  / 10 vials), Tesamorelin/Ipamorelin 5mg/5mg as `PRICE_NEEDED`.
- Test suite: 42 tests (27 unit + 15 integration against a real ephemeral
  PostgreSQL 16), all passing — organization isolation, duplicate
  order/conversion/commission, cost math to the exact digit, bulk vs small,
  historical snapshot across reprice, missing price, profit calc, merchant fee
  not configured, refunds, reversals, MLM ledger rows, protected affiliate,
  audit + automation events, payout double-pay protection, secret redaction.
- `/docs` documentation set (architecture, data model, commission rules,
  financial model, integrations, env vars, runbook, security, acquisition
  readiness, this changelog).

**Unchanged (deliberately):** Phase 1/2 Vercel webhook logic, Tapfiliate MLM
settings (L2 3%, L3 2%), affiliate percentages, Sellavi configuration, the
static marketing site and its Pages workflow.

## Phase 2 — Team/MLM override infrastructure (prior)

- Tapfiliate native MLM operational: selling affiliate personal rate +
  3% level 2 + 2% level 3; protected-group rule for legacy affiliates.
- End-to-end verified: referral click → Sellavi order → Tapfiliate conversion
  → correct order value → personal + L2 + L3 commissions.

## Phase 1 — Personal affiliate tier automation (prior)

- Personal affiliate tier automation built, tested, live (Vercel backend +
  Tapfiliate + Sellavi referral tracking).
