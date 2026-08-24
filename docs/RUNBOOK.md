# Runbook

Operational procedures for the Data Core. Everything here is reproducible from
this repository — the database can be rebuilt from migrations + seeds at any
time.

## Local development

```sh
cd data-core
npm install
cp .env.example .env            # set DATABASE_URL to a local postgres
npm run migrate                 # apply migrations (forward-only, idempotent)
npm run seed                    # tenant #1 + supplier + known costs (idempotent)
npm test                        # unit + integration (boots a throwaway postgres)
```

`npm run migrate:status` lists applied vs pending migrations.

## Provisioning production (NOT DONE — requires approval)

1. Choose a managed PostgreSQL (recommendation: Neon / Supabase / RDS — see
   the Phase 3 report; free tiers exist, paid tiers need approval).
2. Create the database + a least-privilege app role; enable TLS.
3. Set `DATABASE_URL` (+ `DATABASE_SSL=require`) in Vercel env vars only.
4. Run `npm run migrate` then `npm run seed` against it (from CI or a trusted
   shell — the runner takes an advisory lock, so concurrent runs are safe).
5. Verify: `npm run migrate:status` shows all versions applied.
6. Only then wire the Vercel webhook handlers to the ingestion functions.

## Schema changes

- Never edit an applied migration (the checksum check will refuse to run) —
  add a new numbered migration.
- Never write a "down" migration for production; correct forward.
- Test locally: `npm test` boots a fresh cluster and applies every migration
  from zero, so a broken migration fails before it ships.

## Supplier reprice (cost change)

1. `UPDATE product_costs SET effective_to = <cutover>` on the open window.
2. `INSERT` the new window with `effective_from = <cutover>` and the new kit
   prices, `source_reference` pointing at the new price list.
3. Never `UPDATE` prices in place, never delete old windows — historical
   orders depend on them. The exclusion constraint rejects overlaps.

## Importing the full supplier catalog (pending)

The wholesale PDF import is a deliberate, reviewed step: create `products` +
`product_costs` rows per item; any item without a displayed price gets
`cost_status = 'PRICE_NEEDED'` (no invented numbers, no substituting another
strength). Recommended as a seed-style idempotent SQL file reviewed against
the PDF before running.

## Filling a missing price later

Insert a new PRICED window from the date the price became known. Orders
already ingested with `PRICE_NEEDED` lines keep NULL COGS until a deliberate,
audited backfill is approved (re-snapshot those lines, recalc financials, one
audit entry per touched order).

## Payout release (failed/cancelled payouts)

`releasePayout` sets the payout FAILED/CANCELLED, returns its commissions to
`approved`, deletes the payout_items rows (freeing the one-payout-per-
commission slot), and writes an audit entry. Zelle payouts are manual by
definition: create → pay by hand → `settlePayout`.

## Onboarding a new organization (future)

Insert an `organizations` row + `organization_settings`, then that tenant's
suppliers/products/costs. No schema or code changes. Do not reuse tenant #1's
external system accounts.

## Backups & recovery

Schema/seeds: reproducible from GitHub. Data: enable the provider's automated
daily snapshots + PITR when provisioning; test a restore once after setup.
Restore drill: provision an empty instance → restore snapshot → run
`npm run migrate:status` to confirm schema version → point a staging
`DATABASE_URL` at it and spot-check row counts.

## Incident basics

- Webhook replays are always safe (idempotent ingestion) — re-deliver freely.
- Suspected duplicate/missing data: check `automation_events` for the external
  event id, then `audit_log` for the entity.
- Never hand-edit financial rows; use reversals/adjustments so the ledger and
  audit trail stay truthful.
