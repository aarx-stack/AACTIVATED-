# AACTIVATED Data Core (Phase 3)

Multi-tenant PostgreSQL foundation for the AACTIVATED platform: migrations,
exact-decimal financial engine, idempotent ingestion (Sellavi orders,
Tapfiliate conversions/commissions), payouts, automation events, audit log.

Full documentation lives in [`/docs`](../docs) — start with
[ARCHITECTURE.md](../docs/ARCHITECTURE.md) and
[DATA_MODEL.md](../docs/DATA_MODEL.md).

## Quickstart

```sh
npm install
cp .env.example .env      # point DATABASE_URL at a PostgreSQL 14+
npm run migrate           # apply schema (forward-only, checksummed)
npm run seed              # tenant #1: AACTIVATED_RX (+ supplier, known costs)
npm test                  # 42 tests; integration boots a throwaway postgres
```

## Layout

| Path | Purpose |
| --- | --- |
| `migrations/` | Numbered forward-only SQL migrations (the schema) |
| `seeds/` | Idempotent tenant/reference data |
| `src/money.js` | Exact decimal arithmetic (BigInt micros — floats rejected) |
| `src/costing.js` | Supplier kit→vial cost engine (tiers, logistics rate) |
| `src/financials.js` | Pure order P&L calculator |
| `src/db.js` | Pool/transaction helpers |
| `src/migrate.js` / `src/seed.js` | Runners (also CLIs) |
| `src/ingest/` | Idempotent Sellavi + Tapfiliate ingestion |
| `src/services/` | Financial calc, payouts, group-change guard, events, audit |
| `test/` | Unit + integration suites (ephemeral local PostgreSQL harness) |

**Status:** schema and engine complete and tested. No production database is
provisioned and no live system writes to it yet — see
[docs/RUNBOOK.md](../docs/RUNBOOK.md) for the provisioning procedure (pending
approval).
