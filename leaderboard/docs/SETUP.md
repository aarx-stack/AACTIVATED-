# Connecting real data (Phase 2 guide)

The demo needs nothing. This guide is for wiring the built backend to real
services. Do these in order; the app stays honest at every step — anything
unconnected shows as unconnected, never as fake data.

## 0 · Verify before connecting (required)

The build environment could not reach `tapfiliate.com` (network egress
blocked), so the Tapfiliate adapter follows the historically documented REST
API v1.6 and is marked with `verify` notes. Before enabling:

1. Open the current Tapfiliate REST docs (tapfiliate.com/docs) and confirm:
   base URL/version, the `Api-Key` auth header, `/conversions/` +
   `/affiliates/` endpoints and their pagination (Link header vs. params),
   rate limits, and the exact webhook event payloads (Conversion created,
   Commission created/updated, Customer created/updated are advertised).
2. Confirm what **your subscription includes** — especially MLM/team
   relationship data (`parent_id` on affiliates). If MLM data isn't
   available, leave team edges unverified: the app will show **“Team data
   not connected”** rather than guessing.
3. Confirm how your Sellavi store can expose **paid-order status** (API,
   webhook, or export). Until that contract is confirmed, payment
   verification stays in **manual mode** (admin review queue) — unpaid
   Zelle/manual orders can never count as paid sales.
4. Confirm the amount semantics of your Tapfiliate conversions (gross vs.
   net, tax/shipping included?) so `conversionToTxn` maps fields correctly.

Update `worker/adapters/*.ts` where a `verify` note disagrees with current
docs. Do not invent endpoints or headers.

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
