# Integrations

How external systems feed the Data Core. Phase 3 ships the ingestion
**functions and schema**; wiring them into the live Vercel webhook handlers is
the next deployment step and happens only after the database is approved and
provisioned ([RUNBOOK.md](./RUNBOOK.md)).

## Sellavi → Data Core (orders)

Path: Sellavi webhook / order export → Vercel backend (existing Phase 1/2
handler) → `ingestSellaviOrder` (`data-core/src/ingest/sellavi.js`) inside one
transaction.

1. Normalize the Sellavi payload to `{externalOrderId, currency, subtotal,
   discountTotal, refundTotal, customerReference, orderStatus,
   financialStatus, orderedAt, items[{externalProductId, sku, quantity,
   unitPrice}]}`. Store external references only — no card data
   ([SECURITY.md](./SECURITY.md)).
2. Upsert the order on `(organization_id, source='SELLAVI',
   external_order_id)` — e.g. `SELLAVI-4852`. Replays update, never duplicate.
3. Per line: resolve the product (`external_sellavi_product_id` first, then
   internal `sku`), resolve the cost window in force at `ordered_at`, and
   freeze the COGS snapshot. Missing prices → `PRICE_NEEDED` lines. Existing
   snapshots are never overwritten by replays.
4. Record an `ORDER_IMPORTED` automation event (deduped by the webhook
   delivery id, or `order-import:<external_order_id>` when the source has no
   delivery id).
5. `calculateOrderFinancials` may then upsert the per-order P&L row.

Unmapped products still ingest (NULL `product_id`, external ids preserved) so
an incomplete catalog mapping never drops revenue data.

## Tapfiliate → Data Core (affiliates, conversions, commissions)

Path: Tapfiliate webhooks (conversion created/approved, commission events) and
periodic API sync → Vercel backend → `data-core/src/ingest/tapfiliate.js`.

- `upsertAffiliate` — mirror affiliates on
  `(organization_id, external_tapfiliate_id)`; business flags
  (`protected_group`, `team_builder`) are Data-Core-owned and survive replays
  unless explicitly changed. The Phase 1 webhook recognizes protected groups
  by Tapfiliate group-title keywords (`competitive`, `elevate`, `strategic`);
  the sync sets `protected_group = true` for affiliates in those groups so the
  Data Core guard agrees with the live automation.
- `setSponsor` — maintain the effective-dated sponsor tree (closes the old
  edge, opens a new one, audited).
- `ingestConversion` — one row per `(organization_id,
  external_conversion_id)`; links to the Sellavi order via the shared external
  order id.
- `recordCommission` — one ledger row per commission (DIRECT / MLM_LEVEL_2 /
  MLM_LEVEL_3 / BONUS / MANUAL_ADJUSTMENT), idempotent on the external
  commission id and on `(conversion, affiliate, type)`.
- `reverseCommission` — append-only negative REVERSAL + audit.

The end-to-end flow proven in Phase 2 (click → Sellavi order → Tapfiliate
conversion → personal + L2 + L3 commissions) maps 1:1 onto: `ingestSellaviOrder`
→ `ingestConversion` → three `recordCommission` calls.

## Idempotency strategy (all sources)

Every external event lands behind an organization-scoped unique key and an
`ON CONFLICT` upsert, so at-least-once webhook delivery is safe:

| Event | Key |
| --- | --- |
| Sellavi order | `(org, 'SELLAVI', external_order_id)` |
| Order line | `(order_id, line_number)` |
| Tapfiliate conversion | `(org, external_conversion_id)` |
| Commission | `(org, external_commission_id)` + `(org, conversion, affiliate, type)` |
| Payout | `(org, external_payout_id)`; `commission_id` unique in payout_items |
| Automation event | `(org, source_system, external_event_id)` |

Rules: replays converge (update-in-place of mutable fields); frozen facts
(cost snapshots, terminal statuses `paid`/`reversed`) never regress; the same
external id in two organizations is two independent records.

## Payout providers (future)

Payout methods are provider-neutral (`ACH`, `BANK_TRANSFER`, `PAYPAL`,
`ZELLE`, `OTHER`). The automatable-provider allowlist
(`src/services/payouts.js`) is **empty**: no provider (e.g. Trolley) is
integrated or approved, and Zelle has no supported payout API, so every payout
is `MANUAL_ONLY` and settlement is a human action recorded by `settlePayout`.
Integrating a provider is an explicit future decision (cost + approval), after
which that provider stores only external payout ids here — never bank
credentials.

## Environments

The Vercel backend reaches the database via `DATABASE_URL` only
([ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)). Webhook
authenticity (Sellavi signatures, Tapfiliate keys) stays in the Vercel layer
exactly as in Phase 1/2 — the Data Core never stores those secrets.
