# AACTIVATED AI Brain

The internal operating system for AACTIVATED RX. An AI CEO ("the Brain") runs a company team of
AI agents across departments and gives every Premium rep a private AI team. **Humans approve
anything that leaves the building.**

> Status: **Phase 1 complete.** That covers setup, design tokens, layout shell, auth and roles,
> seeded demo data, and pages 1 (Command Center), 2 (Company Team) and 12 (Admin), all in dark
> and light themes. The other pages are permission-guarded placeholders labelled with the phase
> that delivers them.

## Stack

| Area    | Choice                                                                      |
| ------- | --------------------------------------------------------------------------- |
| App     | Next.js 16 (App Router), React 19, TypeScript (strict)                      |
| UI      | Tailwind CSS 4, shadcn/ui-style components on Radix, lucide-react, Recharts |
| Data    | PostgreSQL 16 + Prisma 7 (driver adapter `@prisma/adapter-pg`)              |
| Auth    | Auth.js v5: email magic link, invite-only, role-based access                |
| AI      | One server-side module (`src/lib/ai`). Mock by default; Claude via env var  |
| Jobs    | pg-boss (runs on the same Postgres, so there is no Redis)                   |
| Tests   | Vitest (unit + integration), Playwright (end to end)                        |
| Quality | ESLint (flat config), Prettier                                              |

## Quick start

Requirements: Node 22.12+, Docker (or a local PostgreSQL 16).

```bash
cp .env.example .env               # then set AUTH_SECRET: openssl rand -base64 32
docker compose up -d               # Postgres (dev + test databases) and Mailpit
npm install
npm run db:deploy                  # apply migrations
npm run db:seed                    # demo data
npm run dev                        # http://localhost:3000
```

In a second terminal, run the background worker. It records health heartbeats; without it the
system shows as **degraded**, never down:

```bash
npm run worker
```

### Signing in

- **Demo picker (development only).** With `DEMO_LOGIN_ENABLED=true`, the login page lists the
  seeded users. Pick one to sign in as that role. The app refuses to start if this is enabled
  with `APP_ENV=production`.
- **Magic link.** Enter an invited email address. With `EMAIL_TRANSPORT=console` the link is
  printed in the dev-server terminal. With `EMAIL_TRANSPORT=smtp` it goes to Mailpit at
  <http://localhost:8025>. Accounts are invite-only, and the page answers the same way whether or
  not an address exists.

### Demo users

| User          | Email                    | Role                       |
| ------------- | ------------------------ | -------------------------- |
| Guy Griffithe | `guy@aactivated.test`    | Executive (final approver) |
| Isaac Muniz   | `isaac@aactivated.test`  | System Admin               |
| Maya Torres   | `maya@aactivated.test`   | Staff (Operations)         |
| Devon Brooks  | `devon@aactivated.test`  | Staff (Marketing)          |
| Jordan Ellis  | `jordan@aactivated.test` | Premium Rep                |
| Sam Carter    | `sam@aactivated.test`    | Free Rep                   |

Everyone except Guy and Isaac is a fictional demo user. All seed addresses use the reserved
`.test` domain, so no real email can be sent. Replace them with real invites from **Admin →
Invite a user** before go-live.

## Scripts

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm run dev`       | Development server                                               |
| `npm run worker`    | Background worker (pg-boss): heartbeat and health checks         |
| `npm run check`     | Type-check, lint, format check and all Vitest suites             |
| `npm test`          | Unit and integration tests (integration needs the test database) |
| `npm run test:unit` | Unit tests only (no database)                                    |
| `npm run test:e2e`  | Playwright against a production build (`npm run build` first)    |
| `npm run db:reset`  | Drop, re-migrate and re-seed the **dev** database                |

Integration tests rebuild the database in `TEST_DATABASE_URL` from migrations on every run. They
refuse to touch any database whose name doesn't end in `_test`.

## How the rules are enforced

| Rule                                      | Where                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role-based access, enforced on the server | `src/server/authz/permissions.ts`: one matrix used by every page, action and the Admin matrix                                                                |
| Legal, accounting and HR executive-only   | Permissions plus `policies.ts`. Confidential agents and activity are redacted server-side                                                                    |
| Free reps get Coach and earnings only     | `rep_pod.coach` and `back_office.view_own`; asserted cell by cell in `tests/unit/authz.test.ts`                                                              |
| Who can approve what                      | `src/server/approvals/policy.ts`: staff decide low/medium content; executives decide spend, legal, launches and high risk; nobody approves their own request |
| Audit log is append-only                  | A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` (see the init migration)                                                                        |
| Every change is audited                   | `recordAudit()` runs inside the same transaction as the change                                                                                               |
| Every model call is costed                | `runModel()` writes a `SpendEvent` with agent, model, tokens and USD                                                                                         |
| Always-on                                 | `/api/health`, public `/status`, and error boundaries. A failing integration degrades, never takes the portal down                                           |

Phase 2 builds the approval queue and the outbound dispatch gate. Phase 4 adds the 75% budget
lock. The data model and policies they rely on are already in place.

## AI

`AI_PROVIDER=mock` (the default) is free, offline and deterministic. To use Claude, set:

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...                  # never commit this
ANTHROPIC_MODEL_BRAIN=claude-opus-5-5  # the Brain
ANTHROPIC_MODEL_AGENT=claude-sonnet-5-5  # department and rep agents
```

The Claude adapter uses adaptive thinking with an explicit effort level, and has server-side
refusal fallbacks enabled. Prices per million tokens are in `src/lib/ai/pricing.ts`.

## Integrations

GoHighLevel, QuickBooks and Slack sit behind interfaces in `src/server/integrations` and use
mock adapters by default. Setting an `INTEGRATION_*` flag to `live` currently reports the
integration as down instead of calling anything; live adapters arrive in Phase 5 and need your
approval. To simulate an outage, set `MOCK_INTEGRATIONS_DOWN=SLACK,QUICKBOOKS`.

## Project layout

```
prisma/              schema, migrations (incl. audit-log trigger), seed
src/app/(auth)/      login, check-email
src/app/(app)/       authenticated pages (one folder per page) + server actions
src/app/api/         auth, health
src/app/status/      public status page
src/components/      ui/ (primitives), shell/, command-center/, admin/
src/server/          authz, approvals, audit, auth, health, integrations, jobs, queries, users
src/lib/             ai/, db, env (zod-validated), navigation, utils
src/styles/          globals.css: every design token for both themes
tests/unit, tests/integration, e2e/
```

## Design

The "Obsidian Glass" direction: deep navy base `#0A0E1C` with a grid, glow and noise overlay;
frosted-glass cards with thin electric-blue gradient borders; and a white and silver light
theme. Every color, radius and layout size is a CSS variable in `src/styles/globals.css`. Each
user's theme is saved to their account. Mockups go in `design/reference/`.
