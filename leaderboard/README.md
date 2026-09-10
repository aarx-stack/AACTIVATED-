# AACTIVATED RX — Affiliate Leaderboard

A performance dashboard for the AACTIVATED RX affiliate program: live-style
leaderboards (personal & team), a 30-day Founders Bonus Pool challenge with a
50-seat cap, and an admin control center for verification, ledger corrections
and integration health.

**Current state: Phase 1–3 complete.** The UI runs entirely on clearly
labeled fictional demo data; the Cloudflare Worker backend, D1 schema and
integration adapters are built and tested but not yet connected to live
credentials. Nothing here touches the existing storefront, checkout, PayPal
Worker, DNS, or Tapfiliate tracking scripts.

## Run the demo

```sh
npm install
npm run dev        # → http://localhost:5173
```

Use the **DEMO CONTROLS** panel (bottom right) to:

- switch between the **Affiliate** and **Admin** views (preview-only switch —
  production access comes from real sign-in and server-side roles; this
  control does not exist there);
- preview personas for every state: in-progress, qualified, pending
  verification, not started, window ended, membership expired, and
  team-data-not-connected;
- toggle **All 50 seats claimed** (capacity state) and **sync failure**
  (degraded-connection state);
- post a simulated sale to watch the board update.

Everything on screen is fictional and stamped **DEMO — NOT LIVE**. Demo data
lives only in browser memory (`src/data/fixtures.ts`); production data lives
in D1 behind the Worker. The two never mix.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (demo data) |
| `npm run build` | Production build to `dist/` |
| `npm run verify` | Typecheck (app, worker, tests) + tests + build |
| `npm run test` | Vitest suite (61 tests, see below) |
| `npm run worker:dev` | Wrangler dev: Worker + built SPA + local D1 |
| `npm run db:migrate:local` / `:remote` | Apply D1 migrations |
| `npm run screenshots` | Playwright screenshots (desktop + mobile) |

## What the tests cover

`tests/` exercises the rules that must never regress: duplicate webhook
deliveries; paid vs unpaid (Zelle) orders; full & partial refunds; enrollment
before/after launch; exact window deadline boundaries; monthly-rankings ↔
challenge-window independence; team double-counting prevention (commission
records are structurally excluded); concurrent claims of the final pool seat
(real SQLite semantics via `node:sqlite`); and unauthorized access (fail-closed
auth, role checks, response field filtering, webhook secret handling).

## Layout

```
shared/       Domain rules used by BOTH the demo and the Worker:
              eligibility policy, LA-timezone periods, challenge windows &
              status precedence, team rollup, ranking/movement.
src/          React 19 + Vite + Tailwind v4 frontend (demo store included).
worker/       Cloudflare Worker: auth (Cloudflare Access, fail closed),
              routes with per-role field filtering, atomic seat claims,
              idempotent webhook ingestion, Tapfiliate/Sellavi adapters,
              scheduled reconciliation + snapshots.
migrations/   D1 schema (transaction ledger, seats, audit log, snapshots…).
docs/         SETUP (connect real data), TIME_AND_BOUNDARIES (exact boundary
              semantics), DECISIONS_NEEDED (confirm before production).
```

## Ground rules encoded in the code

- **Eligible sales** (proposed policy, confirm before activation): verified-paid
  product revenue, net of discounts and refunds, excluding tax and shipping.
  A Tapfiliate conversion is never proof of payment.
- **Bonus windows**: enrolled before launch → 30 days from launch; on/after →
  30 days from enrollment; exactly 720 hours; `[start, end)`; no automatic
  restarts; production shows “Launch date pending” until a date is configured.
- **Three alternative paths**: $10,000 direct / $50,000 team (verified
  relationships only) / verified $2,500 Founders Pack — any one qualifies.
  First 50 verified qualifiers; membership lasts one year.
- **Never invented**: commission rates, tier thresholds, pool value, payout
  estimates, distribution rules, or a fake “Live” indicator.
- All stored instants are UTC; **America/Los_Angeles** is used for reporting
  and display (see `docs/TIME_AND_BOUNDARIES.md`).
