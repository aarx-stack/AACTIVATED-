#!/usr/bin/env bash
# One-shot deploy for the live Worker + D1 + 15-minute auto-refresh (option A:
# public read-only board). Run from the leaderboard/ directory, on a machine
# whose network can reach api.cloudflare.com (Claude's managed cloud
# environment blocks it by policy — see docs/DEPLOY.md).
#
#   export CLOUDFLARE_API_TOKEN=...   CLOUDFLARE_ACCOUNT_ID=...
#   export TAPFILIATE_API_KEY=...     TAPFILIATE_WEBHOOK_SECRET=...
#   bash scripts/deploy.sh
#
# Idempotent: safe to re-run. It never prints secret values.
set -euo pipefail

need() { [ -n "${!1:-}" ] || { echo "✘ missing env var: $1" >&2; exit 1; }; }
need CLOUDFLARE_API_TOKEN
need CLOUDFLARE_ACCOUNT_ID
need TAPFILIATE_API_KEY
need TAPFILIATE_WEBHOOK_SECRET

DB_NAME="aactivated_leaderboard"

echo "▸ 1/6  Ensuring D1 database '$DB_NAME' exists"
# Wrangler may print an informational note before the JSON, so slice from the
# first '[' and parse tolerantly.
DB_ID="$(npx wrangler d1 list --json 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=s.indexOf("[");let j=[];try{j=JSON.parse(i>=0?s.slice(i):s)}catch{}const m=Array.isArray(j)?j.find(d=>d.name===process.argv[1]):null;process.stdout.write(m?(m.uuid||m.database_id||""):"")})' "$DB_NAME" || true)"
if [ -z "$DB_ID" ]; then
  CREATE_OUT="$(npx wrangler d1 create "$DB_NAME")"
  DB_ID="$(printf '%s' "$CREATE_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
fi
[ -n "$DB_ID" ] || { echo "✘ could not determine D1 database_id" >&2; exit 1; }
echo "  database_id resolved"

echo "▸ 2/6  Writing database_id into wrangler.jsonc"
if grep -q "REPLACE_WITH_D1_DATABASE_ID" wrangler.jsonc; then
  sed -i.bak "s/REPLACE_WITH_D1_DATABASE_ID/$DB_ID/" wrangler.jsonc && rm -f wrangler.jsonc.bak
fi

echo "▸ 3/6  Applying migrations (remote)"
npx wrangler d1 migrations apply "$DB_NAME" --remote

echo "▸ 4/6  Storing Worker secrets"
printf '%s' "$TAPFILIATE_API_KEY"        | npx wrangler secret put TAPFILIATE_API_KEY
printf '%s' "$TAPFILIATE_WEBHOOK_SECRET" | npx wrangler secret put TAPFILIATE_WEBHOOK_SECRET

echo "▸ 5/6  Building frontend (live) + deploying Worker, assets, crons"
VITE_DATA_MODE=live npm run build
DEPLOY_OUT="$(npx wrangler deploy)"
printf '%s\n' "$DEPLOY_OUT"
URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)"

echo "▸ 6/6  Backfilling history (initial full import)"
if [ -n "$URL" ]; then
  curl -fsS -X POST "$URL/api/internal/reconcile/$TAPFILIATE_WEBHOOK_SECRET?full=1" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log("  backfill:",JSON.stringify(j.lastRun))}catch{console.log(s)}})' || \
    echo "  (backfill call failed — the 15-min cron will import on its next run)"
  echo
  echo "✅ Live at: $URL"
  echo "   Register the Tapfiliate webhook (conversion/commission events):"
  echo "     $URL/api/webhooks/tapfiliate/<TAPFILIATE_WEBHOOK_SECRET>"
else
  echo "  Deployed, but could not parse the workers.dev URL from output — check the dashboard."
fi
