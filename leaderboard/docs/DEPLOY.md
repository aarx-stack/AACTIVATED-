# Deploy runbook — live Worker + 15-minute auto-refresh

This turns the app into a self-updating live service: a Cloudflare Worker
serves the site and API, a **D1** database holds the ledger, and a **cron
trigger runs every 15 minutes** to pull eligible changes from Tapfiliate
(`worker/jobs/reconcile.ts`) — plus webhooks for near-instant updates on
each sale. Verified deployable via `wrangler deploy --dry-run` (bundles clean,
D1 binding + crons recognized).

Nothing here is destructive to your existing storefront, checkout, PayPal
Worker, DNS, or Tapfiliate tracking — it is a separate Worker + database.

## What you provide (once)

Add these to the Claude Code environment (Settings → environment variables —
never pasted into chat or committed):

| Name | What it is / how to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token. Permissions: **Account · Workers Scripts · Edit**, **Account · D1 · Edit**, **Account · Workers KV Storage · Edit** (Wrangler state), and **Zone · Workers Routes · Edit** only if you attach a custom domain. Scope it to your account. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → account ID (right sidebar). |
| `TAPFILIATE_API_KEY` | Tapfiliate → Settings → API. Read access to affiliates + conversions. Stored as a Worker secret, never in the frontend. |
| `TAPFILIATE_WEBHOOK_SECRET` | A random high-entropy string (Claude generated one for you). Becomes the secret path segment of the webhook URL. |

## Where this can run

`wrangler` talks to `api.cloudflare.com`. **Claude's managed cloud
environment blocks that host by egress policy** (verified: the proxy returns
`403` to the CONNECT), so the deploy cannot run from a normal Claude Code web
session. Run it from any of:

1. **Your own machine** — `git clone`, `cd leaderboard`, `npm ci`, export the
   four vars, `npm run deploy`.
2. **A Claude Code environment whose network policy allows Cloudflare** — then
   Claude can run `npm run deploy` for you.
3. **Cloudflare Workers Builds** — connect this repo in the Cloudflare
   dashboard (Workers & Pages → Create → Connect to Git), set the build
   command to `VITE_DATA_MODE=live npm run build` and add the same secrets +
   vars there; every push deploys automatically, no local egress needed.

## One command

With the four vars exported, `npm run deploy` (→ `scripts/deploy.sh`) does the
whole sequence below idempotently: ensure D1, write its id into
`wrangler.jsonc`, migrate, store secrets, build live, deploy, and backfill.
`PUBLIC_BOARD=1` is already set in `wrangler.jsonc` (option A). The manual
steps, for reference:

## Deploy sequence (what the script runs)

```sh
cd leaderboard

# 1. Create the database, capture its id into wrangler.jsonc
npx wrangler d1 create aactivated_leaderboard
#    → paste the printed database_id over REPLACE_WITH_D1_DATABASE_ID

# 2. Create the schema
npx wrangler d1 migrations apply aactivated_leaderboard --remote

# 3. Store secrets (piped from the environment, never echoed)
printf '%s' "$TAPFILIATE_API_KEY"        | npx wrangler secret put TAPFILIATE_API_KEY
printf '%s' "$TAPFILIATE_WEBHOOK_SECRET" | npx wrangler secret put TAPFILIATE_WEBHOOK_SECRET

# 4. Build the frontend for live mode and deploy Worker + assets + crons
VITE_DATA_MODE=live npm run build
npx wrangler deploy

# 5. Backfill all history now (don't wait for the first cron):
curl -X POST "https://<worker-subdomain>.workers.dev/api/internal/reconcile/$TAPFILIATE_WEBHOOK_SECRET?full=1"
#    then confirm rows landed:
npx wrangler d1 execute aactivated_leaderboard --remote \
  --command "SELECT COUNT(*) AS affiliates FROM affiliates; SELECT COUNT(*) AS txns FROM transactions;"
```

The reconcile job imports affiliates + MLM hierarchy first, then conversions,
so a fresh database populates in one call. After that the `*/15` cron keeps it
current and webhooks push near-instant updates.

## Register the Tapfiliate webhook

In Tapfiliate → Settings → Webhooks, add the conversion/commission events with
the URL:

```
https://<your-worker-subdomain>.workers.dev/api/webhooks/tapfiliate/<TAPFILIATE_WEBHOOK_SECRET>
```

Payloads are treated as hints only — the Worker re-fetches the referenced
conversion from the authenticated REST API before writing, and deduplicates
deliveries, so a forged POST can at most trigger a re-sync.

## Viewing the live board (one decision)

The 15-minute refresh runs server-side regardless. To *view* the result, the
API is fail-closed by design, so pick one:

- **Public read-only board (recommended, fast).** Serve the leaderboard
  (rank, approved display name, eligible sales, order count, movement,
  recognition names) without login — the same fields already on the shared
  board. My Performance and Admin stay private. Claude wires this and gates
  it behind `PUBLIC_BOARD=1`. No identity provider needed.
- **Full Cloudflare Access.** Put the whole app behind Access (Zero Trust),
  map each person to their affiliate record in `auth_users`, and every view
  is authenticated. More setup (identity provider + provisioning); needed for
  affiliates to see their own performance and for admin.

You can start with the public board and add Access later.

## Rollback

`npx wrangler rollback` reverts to the previous Worker version. The D1 data is
untouched by a code rollback. Deleting the whole thing:
`npx wrangler delete` (Worker) and `npx wrangler d1 delete aactivated_leaderboard`.
