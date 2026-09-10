# Connecting real data (Phase 2 guide)

The demo needs nothing. This guide is for wiring the built backend to real
services. Do these in order; the app stays honest at every step — anything
unconnected shows as unconnected, never as fake data.

## Snapshot mode (working today, no credentials in code)

Real Tapfiliate data can be rendered right now via the authorized Claude
Tapfiliate connector: raw pulls are transformed by
`scripts/build-snapshot.mjs` into the git-ignored
`src/data/live-snapshot.json` (PII stripped — no emails, phones, addresses
or customer data; display names derived as “First L.”), and

```sh
node scripts/build-snapshot.mjs <raw-affiliates.json> <raw-conversions.json>
VITE_DATA_MODE=snapshot npm run build
```

produces a **read-only, point-in-time** board labeled with its exact sync
time. Snapshot counting policy (confirm before production): a conversion
recorded by the Sellavi→Tapfiliate integration counts as checkout revenue;
conversions whose direct commission is dis-approved in Tapfiliate are
excluded. Refreshing = re-pulling and re-running the transform. This mode
never auto-updates and never fakes “live”.

## 0 · Verified against the live account (Sep 2026)

Checked through the real `aactivatedrx` program (advertiser 64407) via the
Claude connector — these are facts, not doc assumptions:

- REST v1.6 shapes match the adapter: `/affiliates/` and `/conversions/`
  paginate at 25 rows/page; conversions carry `external_id`
  (`SELLAVI-####`, occasionally a doubled `SELLAVI-SELLAVI-####` prefix —
  ledger keys on the raw id), `amount` as a single number (**no
  tax/shipping/discount breakdown**), `created_at`, `affiliate.id`, and a
  `commissions[]` array (`kind: regular|level`, `approved:
  null|true|false`).
- **MLM is active on this plan**: `parent_id` is populated (e.g. a real
  3-level chain), so team rollups have a live source. Production still
  keeps imported edges behind admin verification.
- Commission records are per-level (`level-2` rows exist) — confirming why
  revenue must come from conversions, never summed commissions.
- Conversions include customer emails — the transform and the Worker
  adapter must keep dropping them (they never reach the frontend or D1
  public fields).

Still to confirm with Tapfiliate docs/support before the Worker goes live:
current webhook event payload shapes and any rate limits (tapfiliate.com
was unreachable from the build environment).

Also confirm how your Sellavi store can expose **paid-order status** (API,
webhook, or export). Until that contract is confirmed, payment verification
stays in **manual mode** (admin review queue) — unpaid Zelle/manual orders
can never count as paid sales. Update `worker/adapters/*.ts` where a
`verify` note disagrees with current docs. Do not invent endpoints or
headers.

## 1 · Create the database

```sh
npx wrangler d1 create aactivated_leaderboard
# put the returned database_id into wrangler.jsonc
npm run db:migrate:remote
```

## 2 · Secrets & vars (server-side only)

```sh
npx wrangler secret put TAPFILIATE_API_KEY
npx wrangler secret put TAPFILIATE_WEBHOOK_SECRET   # openssl rand -hex 24
# only if a Sellavi API contract is confirmed:
npx wrangler secret put SELLAVI_API_KEY
```

Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` as plain vars (see step 3). For
local dev, copy `.dev.vars.example` → `.dev.vars` (git-ignored). Credentials
never go in frontend code, source control, or chat.

## 3 · Real authentication (before any production access)

Put the Worker behind **Cloudflare Access** (Zero Trust):

1. Create an Access application for the leaderboard hostname; note the team
   domain (`<team>.cloudflareaccess.com`) and the application **AUD** tag.
2. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` on the Worker.
3. The Worker verifies the `Cf-Access-Jwt-Assertion` JWT on **every** /api
   request and resolves identity through the `auth_users` table
   (subject → affiliate_id + role). Provision rows for each user:

```sql
INSERT INTO auth_users (id, provider, subject, email, affiliate_id, role)
VALUES (lower(hex(randomblob(16))), 'cloudflare_access', '<jwt sub>',
        '<email>', '<affiliate id or NULL>', 'affiliate' /* or 'admin' */);
```

Unset config → every protected endpoint returns 503 (fail closed). An
authenticated but unprovisioned user gets 403. There is no demo bypass; the
demo's view switch exists only in the demo bundle.

## 4 · Import & webhooks

1. **Initial historical import**: with the API key set, run the reconcile
   job once with a wide window (temporarily raise the look-back in
   `worker/jobs/reconcile.ts`, or trigger it repeatedly) so the ledger and
   affiliate list backfill. Verify totals against Tapfiliate's own reports.
2. **Webhooks**: register
   `https://<worker-host>/api/webhooks/tapfiliate/<TAPFILIATE_WEBHOOK_SECRET>`
   for the conversion/commission events per current docs. Payloads are
   treated as hints only — the Worker re-fetches the referenced conversion
   from the REST API before writing, so forged posts can't inject data.
   Deliveries are deduplicated (`webhook_events`), and failures are stored
   and recovered by the 15-minute reconcile cron.
3. **Payment verification**: manual mode works from day one via the admin
   review queue. When Sellavi integration is confirmed, implement
   `SellaviApiVerifier.lookupOrder` per their documented contract and set
   the secret; verified payments then flow automatically.

## 5 · Deploy (only with owner approval)

```sh
npm run build && npx wrangler deploy
```

Frontend live mode: build with `VITE_DATA_MODE=live` once the API is up.
The final wiring of the live data provider (pointing the UI hooks at
`/api/*` with 60-second polling) is the last integration step and is
intentionally not active while credentials are absent.

## 6 · Before switching qualification on

`challenge_config.activated` stays `0` until the items in
`docs/DECISIONS_NEEDED.md` are confirmed (eligibility policy, seat-priority
timing, membership start basis, rollup policy, refund policy) **and** the
real launch date is set. Until then affiliates see “Launch date pending.”
