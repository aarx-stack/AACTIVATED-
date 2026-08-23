# Tapfiliate Affiliate Tier Webhook

Vercel serverless endpoint that keeps AACTIVATED RX affiliates in the correct
commission group based on their **current-calendar-month qualifying sales**.

Endpoint: `POST /api/tapfiliate-webhook` (source: `api/tapfiliate-webhook.js`)

## What it does

On every Tapfiliate **Conversion created** webhook event it:

1. **Authenticates** the request — a `?token=` shared secret (constant-time
   compared against `WEBHOOK_TOKEN`) and/or an HMAC-SHA256 signature check
   against `TAPFILIATE_WEBHOOK_SECRET`. Unauthenticated requests get `401`.
2. **Deduplicates** by conversion ID (Upstash Redis / Vercel KV when
   configured, atomic `SET NX`). A replayed webhook is acknowledged with
   `{"status":"duplicate"}` and does nothing.
3. **Identifies the affiliate** from the payload (or by fetching the
   conversion from the API when the payload is thin).
4. **Sums the month's qualifying sales** — every conversion for that affiliate
   in the current calendar month (`TIER_TIMEZONE`, default UTC), **excluding
   refunded/disapproved conversions** (any conversion whose commissions are
   all `approved: false`). Pending conversions count by default
   (`COUNT_PENDING_COMMISSIONS=false` to require approval). Money math is done
   in integer cents.
5. **Calculates the tier**:

   | Monthly qualifying sales | Group        |
   |--------------------------|--------------|
   | $0 – $999.99             | Standard 15% |
   | $1,000 – $2,499.99       | Starter 20%  |
   | $2,500 – $4,999.99       | Builder 25%  |
   | $5,000 – $9,999.99       | Pro 30%      |
   | $10,000+                 | Elite 35%    |

6. **Moves the affiliate** into the matching **existing** affiliate group via
   the Tapfiliate REST API — commission percentages are never touched, no
   groups are ever created, only membership changes. Upgrades and downgrades
   both happen; the tier resets naturally when a new month starts.

### Hard safety rules

- **Protected B2B groups are never touched**: affiliates currently in
  *Competitive 40%*, *Elevate 45%* or *Strategic Partner 50%* (keyword match,
  plus optional `PROTECTED_GROUP_IDS`) are always skipped.
- Affiliates in any **other unrecognized group** are also left alone
  (`skipped_non_tier_group`) — the automation only ever moves affiliates that
  are ungrouped or already inside one of the five ladder groups.
- **`DRY_RUN` defaults to `true`.** Until you set `DRY_RUN=false` in Vercel,
  the endpoint logs `dry_run_would_move` decisions and performs **zero writes**.
- The only write call in the whole system is the group **membership**
  assignment. Tapfiliate's v1.6 docs describe it as adding the affiliate to an
  existing group; two request shapes exist for it, and the client tries them
  in order (a wrong shape fails 4xx with no side effect, and the accepted
  shape is remembered and logged as `write_endpoint`):
  1. `POST /1.6/affiliate-groups/{group_id}/affiliates/` with
     `{"affiliate": {"id": "<affiliate_id>"}}`
  2. `PUT /1.6/affiliates/{affiliate_id}/group/` with
     `{"group": {"id": "<group_id>"}}`

  Nothing else is ever written: no group creation, no commission changes,
  no affiliate edits.

## Logging

One JSON line per event in the Vercel function logs
(`source: "tapfiliate-tier-webhook"`), containing: `conversion_id`,
`affiliate_id`, `monthly_qualifying_sales_usd`, `current_group`,
`calculated_group`, `action`, `dry_run`, excluded conversions with reasons,
month, and timezone.

Possible `action` values: `moved`, `dry_run_would_move`, `no_change_needed`,
`skipped_protected_group`, `skipped_non_tier_group`,
`skipped_unrecognized_group`, `skipped_ungrouped_by_config`,
`duplicate_skipped`, `ignored`, `error_target_group_not_found`,
`processing_failed`.

## Setup

### 1. Environment variables (Vercel → Project → Settings → Environment Variables)

See `.env.example` for the full list. Minimum:

| Variable | Value |
|---|---|
| `TAPFILIATE_API_KEY` | Tapfiliate → Settings → API keys |
| `WEBHOOK_TOKEN` | e.g. output of `openssl rand -hex 24` |
| `DRY_RUN` | `true` (leave until verified) |
| `TAPFILIATE_PROGRAM_ID` | `aactivatedrx` |

Recommended for production idempotency: add **Upstash Redis** from the Vercel
Marketplace (injects `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
automatically). Without it, dedup falls back to per-instance memory — still
safe, because reprocessing recomputes the same tier and no-ops, but Redis
makes dedup exact across cold starts.

### 2. Register the webhook in Tapfiliate (Triggers)

Tapfiliate delivers webhooks through its **Triggers** feature
(dashboard → **Triggers** tab → **New trigger**):

1. Title it (e.g. "Tier automation — conversion created") and make sure
   **Trigger is currently active** is ON.
2. **Trigger when this happens:** `Conversion created`.
3. **Action:** `Webhook`, with URL:
   `https://<your-vercel-domain>/api/tapfiliate-webhook?token=<WEBHOOK_TOKEN>`

The standard Webhook action posts the conversion object in the same JSON
format as the REST API (id, amount, affiliate, commissions, …) — exactly what
this endpoint parses. (`Webhook (custom)` mode also works: keep the same URL,
or send the token as an `X-Webhook-Token` header instead.)

Note: Tapfiliate does not sign webhooks and has no webhook secret of its own —
the `?token=` is what keeps strangers out. `TAPFILIATE_WEBHOOK_SECRET` exists
only for advanced setups where a fronting proxy adds an HMAC signature.

### 3. Verify in dry-run

Trigger a test conversion (or wait for a real one) and check the Vercel logs
for a `dry_run_would_move` / `no_change_needed` line with sensible numbers.
`GET` on the endpoint is a harmless health check.

### 4. Go live

Set `DRY_RUN=false` in Vercel env vars and redeploy. Watch the first few
`moved` log lines.

## Development

```bash
npm test            # full unit + integration suite, no network needed
```

Everything is dependency-free Node (ES modules, built-in test runner).

## Notes & design decisions

- **Refund after a tier move:** when Tapfiliate disapproves a conversion, no
  webhook fires here, so the affiliate keeps their tier until their next
  conversion re-evaluates the month. The math always uses live API data, so
  the next event self-corrects.
- **Month boundaries** are computed in `TIER_TIMEZONE`; the API is queried
  with a ±1 day padded window and re-filtered exactly, so timezone offsets
  can't drop or double-count conversions at month edges.
- **Failures return 500** after releasing the idempotency claim, so a retry
  or replay can reprocess safely. Tapfiliate does not document trigger retry
  behavior, so if a delivery is lost the affiliate is simply re-evaluated on
  their *next* conversion — the math always uses the full month from the API,
  so no volume is ever lost, only the move is deferred.
- Currency is assumed to be the program currency (USD).
