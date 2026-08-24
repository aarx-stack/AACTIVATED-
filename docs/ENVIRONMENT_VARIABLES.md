# Environment Variables

No secrets in git — values live in the runtime secret manager (Vercel project
env vars) or local `.env` files (git-ignored). `data-core/.env.example` is the
template.

## Required by the Data Core (Phase 3)

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the Data Core | — (required) |
| `DATABASE_SSL` | Set to `require` for managed providers enforcing TLS | empty (off, for local sockets) |

## Test-only

| Variable | Purpose |
| --- | --- |
| `TEST_DATABASE_URL` | Point the integration suite at an existing PostgreSQL. Unset → the suite boots a throwaway local cluster if postgres binaries exist, else skips. |
| `PG_HARNESS_DIR` | Optional working directory for the throwaway test cluster (must be traversable by the `postgres` user when running as root). |

## Existing Phase 1/2 variables (Vercel project — unchanged by Phase 3)

The live webhook glue keeps whatever it already uses (Tapfiliate API key,
Sellavi webhook verification, etc.). Phase 3 does not add, rename, or read
any of them. When the backend adopts the Data Core it adds exactly one new
variable: `DATABASE_URL` (plus `DATABASE_SSL=require` for managed Postgres).

## Future (placeholders only — do not set yet)

| Variable | When it becomes relevant |
| --- | --- |
| `TAPFILIATE_API_KEY` | If/when the Data Core itself performs Tapfiliate API sync (today the Vercel layer owns it) |
| `SELLAVI_WEBHOOK_SECRET` | If/when Sellavi webhook verification moves server-side into shared code |
| Payout-provider credentials | Only after a provider is approved (none is — payouts are MANUAL_ONLY) |

Rules: never commit values; never log values; rotate anything that leaks;
webhook payload storage passes through secret redaction
(`src/services/events.js`) as defense-in-depth.
