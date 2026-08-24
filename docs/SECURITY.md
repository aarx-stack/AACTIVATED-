# Security & Privacy

## What the Data Core never stores

- Full card numbers, CVV, or any cardholder payment data (Sellavi/processor
  keep that; we keep `customer_reference` external ids only).
- Bank login credentials or account/routing numbers (payouts store external
  provider ids only).
- API secrets, webhook secrets, tokens, passwords (no credential columns exist;
  `users` deliberately has no password field — auth is delegated to a future
  IdP via `external_auth_id`).

Minimal PII by design: affiliates carry name/email (needed to run the
program); orders carry an external customer reference, not the customer
record. Sellavi and Tapfiliate remain the systems of record for their PII —
the Data Core does not duplicate what it does not need.

## Defense-in-depth on stored payloads

`automation_events.payload_json`, `audit_log.before_json/after_json` pass
through `redactPayload` (src/services/events.js), which recursively replaces
values under sensitive keys (secret/token/password/api_key/authorization/
card_number/cvv/iban/account_number/ssn/…) with `[REDACTED]` — test-covered.
Callers must still send minimal payloads; redaction is the backstop, not the
policy.

## Secrets handling

- No credentials in git — `.env` is ignored; `.env.example` carries names only.
- Runtime secrets live in the platform secret manager (Vercel env vars).
- `DATABASE_URL` is the only new secret Phase 3 introduces.
- TLS to managed Postgres (`DATABASE_SSL=require`).

## Tenant isolation

- Every operational row carries `organization_id`; every unique key and every
  service query is organization-scoped (test-covered: same SKU / external ids
  coexist across tenants, duplicates within a tenant are rejected).
- Services resolve ids **within** the caller's organization
  (`WHERE organization_id = $1`), so cross-tenant references fail closed.
- Upgrade path (before any second real tenant): PostgreSQL row-level security
  policies keyed on `organization_id`, plus per-tenant application roles. The
  uniform `organization_id` column makes RLS a mechanical addition — no
  redesign.

## Access control

- Database: one least-privilege app role (DML only, no DDL) for the runtime;
  migrations run under a separate migration role. Humans get read-only roles.
- Application: `organization_users.role` (owner/admin/finance/operations/
  affiliate_manager/marketing/viewer) is the RBAC substrate; enforcement
  arrives with authentication (future phase) without schema change.

## Integrity & auditability

- Money is `numeric`, arithmetic is exact BigInt — no float corruption.
- Append-only ledgers (commissions, automation_events, audit_log); corrections
  are REVERSAL/adjustment rows, never edits.
- CHECK constraints, org-scoped unique keys, and exclusion constraints make
  the dangerous states (double pay, overlapping costs, duplicate orders)
  unrepresentable at the database level.
- `audit_log` records actor, action, before/after, reason for significant
  changes — the enterprise diligence trail.

## Operational hygiene

- Webhook signature verification stays at the ingress (Vercel) exactly as in
  Phase 1/2.
- Idempotent ingestion means replay attacks/duplicates converge harmlessly;
  unknown event types are rejected by CHECK constraint.
- Backups/PITR per [RUNBOOK.md](./RUNBOOK.md); restores are drilled, not
  assumed.
