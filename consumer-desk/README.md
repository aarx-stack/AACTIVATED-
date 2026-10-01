# Consumer Desk

A private, single-owner workspace for a consumer-law educator/coach: client and case records,
protected document storage, a letter editor with neutral templates, complete mailing-packet
review and approval, a provider-neutral mailing layer (mock today, LetterStream once its account
documentation is supplied), dispute/correspondence tracking, a response center, follow-ups,
analytics and an audit log.

It runs completely independently of GoHighLevel.

> **Status of the LetterStream connection:** the integration architecture, safety controls and
> Test Center are built, but **no LetterStream API calls are implemented**. LetterStream only
> publishes its API documentation to approved accounts, so endpoints, authentication, fields and
> test behaviour have not been guessed. See [docs/LETTERSTREAM_CHECKLIST.md](docs/LETTERSTREAM_CHECKLIST.md).
> Everything else works today in demo mode and in the connected (Supabase) mode.

- [What works, what is simulated, what is blocked](docs/FEATURE_STATUS.md)
- [LetterStream connection checklist](docs/LETTERSTREAM_CHECKLIST.md)
- [Deployment (Vercel + Supabase)](docs/DEPLOYMENT.md)
- [Security notes and limitations](docs/SECURITY.md)

---

## 1. Quick start — local demo (no accounts needed)

Requirements: Node.js 20.9+ (tested on 22), npm.

```bash
cd consumer-desk
npm ci
npm run dev            # http://127.0.0.1:3000
```

Open <http://127.0.0.1:3000>, click **Enter demo workspace**.

Demo mode facts:

- Three **clearly fictional** clients, cases, letters, a simulated mailing and a response are
  preloaded (created through the real services, so they obey the same rules as your own records).
- Demo data lives **only in server memory** and **resets every time the server restarts**
  (Settings → *Reset demo data* also resets it). Nothing is written to disk or the database.
- Mailing uses the **mock provider**: nothing is printed, mailed or charged; every event is labelled
  “Simulated”. Prices are never invented — the mock reports “no quote available”.
- Uploads require ticking “this file is fictional”. Do not upload real identity documents.
- The demo sign-in shortcut **only works on a loopback address (localhost/127.0.0.1) in
  development** and fails closed in production builds, on Vercel and on any other host name.
- Demo records can never reach a real provider: demo data + any non-mock `MAIL_MODE` blocks all
  submissions, and the LetterStream adapter refuses to be constructed in demo mode.

## 2. Private connected app (Supabase)

Connected mode stores everything in PostgreSQL and a private Storage bucket, protected by
owner-only row-level security. It never falls back to demo data.

### 2.1 Create the Supabase project

1. Create a project at <https://supabase.com> (choose a region near you; free tier is enough to start).
2. **Authentication → Providers → Email**: keep *Email* enabled (it is the owner's sign-in method),
   and **disable “Allow new users to sign up”** (Authentication → Sign In / Providers → *User Signups*).
3. **Authentication → Multi-Factor**: enable **TOTP**.
4. Apply the migrations (creates tables, policies, triggers and the private bucket):

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   (Or paste the two files in `supabase/migrations/` into the SQL editor, in order.)

### 2.2 Create the owner account (once, from your own computer)

The service-role key is used **only** by this script, locally. Never put it in the app's
environment, in Vercel, or in git.

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
OWNER_EMAIL=you@example.com \
OWNER_DISPLAY_NAME="Your Name" \
npm run create-owner        # prompts for a password (12+ chars, letters and digits)
```

This creates/updates the Auth user and registers it as the owner in `public.users`. Only
accounts registered there can read or write anything (enforced by database policies, not by the UI).

### 2.3 Configure and run

```bash
cp .env.example .env.local
# edit .env.local:
#   DATA_MODE=supabase
#   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
#   SUPABASE_ANON_KEY=your-anon-or-publishable-key
#   OWNER_EMAIL=you@example.com
#   MAIL_MODE=mock
#   LIVE_MAILING_ENABLED=false
npm run dev
```

Sign in, then **Settings → Security & MFA → Enroll authenticator app**. After enrolling, set
`REQUIRE_MFA=true` and restart. Once a factor is verified, the database itself refuses record
access to sessions that have not completed the MFA challenge (AAL2).

Before storing any real client documents, complete the checklist on the Settings page
(also in [docs/SECURITY.md](docs/SECURITY.md)).

## 3. Mail modes (server-enforced)

| Header badge | Settings | What happens on “Send” |
| --- | --- | --- |
| `DEMO DATA · MOCK MAIL` | `DATA_MODE=demo`, `MAIL_MODE=mock` | Simulated only. |
| `MOCK MAIL · SIMULATED ONLY` | `DATA_MODE=supabase`, `MAIL_MODE=mock` | Real records, simulated mailing. |
| `LETTERSTREAM PROVIDER TEST` | `MAIL_MODE=provider_test` | Blocked until the LetterStream adapter is implemented. Treated as possibly real/chargeable. |
| `LIVE MODE · SENDING DISABLED` | `MAIL_MODE=live`, `LIVE_MAILING_ENABLED=false` | Blocked. |
| `LIVE MAIL · REAL CHARGES` | `MAIL_MODE=live`, `LIVE_MAILING_ENABLED=true` | Would create real mail (blocked today: adapter not implemented). |
| `MISCONFIGURED` | anything invalid/contradictory | Blocked (fails closed). |

Every submission re-checks the policy on the server, requires the exact approved packet (hash
match), a separate final confirmation, and (for anything that may create real mail) an explicit
“may create a real mailing and incur a charge” acknowledgement. A durable `submitting` record with
a unique packet id and idempotency key is written **before** the provider is contacted, so double
clicks and concurrent requests cannot send twice. Timeouts and ambiguous errors become
**“Submission outcome unknown”** and are never resent automatically.

## 4. Commands

```bash
npm run dev                  # development server on 127.0.0.1:3000
npm run build && npm start   # production build / server (127.0.0.1)
npm run lint                 # ESLint
npm run typecheck            # route types + TypeScript
npm test                     # unit + service tests (Vitest)
npm run check                # lint + typecheck + tests + build

# Real local Supabase (Docker required): Postgres + Auth + Storage with the real migrations
npx supabase start -x studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta
npx supabase db reset        # applies supabase/migrations
npm run test:supabase        # RLS, storage privacy, FKs, MFA policy, duplicate protection

# Browser end-to-end tests (Playwright; builds first)
npm run test:e2e                         # demo mode: full journey, double-click, counts, iPhone layout
npm run test:e2e:connected               # connected mode against the LOCAL Supabase stack
# If Playwright's bundled browser is unavailable, point it at an installed Chromium:
#   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

`test:e2e:connected` uses a disposable local owner (`e2e-owner@example.test`) that only exists in
the local Docker stack.

## 5. Architecture

```
src/
  app/                 Next.js App Router pages, server actions, authenticated file/export routes
  components/          UI (neon glass design system in app/globals.css)
  lib/                 shared labels/formatters (client + server)
  server/
    config.ts          env parsing + resolveMailPolicy() + demoLoginAllowed()  ← safety rules
    context.ts         per-request owner authentication (demo cookie or Supabase session + MFA)
    store/             Store interface; DemoStore (in-memory, fictional) and SupabaseStore (RLS)
    services/          all business rules (clients, letters, packets, mailings, responses, metrics…)
    mail/              provider-neutral interface; MockMailProvider; LetterStreamProvider (blocked)
    pdf/               server-side letter rendering + packet assembly (pdf-lib)
supabase/migrations/   schema, owner-only RLS, integrity triggers, private storage bucket
tests/                 unit, Supabase integration, Playwright e2e
```

- **One app, one database, one private bucket, one isolated provider integration.** No n8n,
  Zapier, Make or extra services.
- **Adding GoHighLevel later:** add an `src/server/integrations/ghl/` module that maps GHL contacts
  to `createClient()`/`updateClient()` calls in `src/server/services/clients.ts` (and records an
  external id). The UI, stores and mailing layer do not need to change.
- **Adding the real LetterStream API:** implement the four methods in
  `src/server/mail/letterstream-provider.ts` from the account documentation and flip each
  capability to `supported: true` with its documentation reference. The Test Center buttons,
  quotes, tracking and submission flow light up from those capability flags automatically.

## 6. Relational model

`users` (owner registry) · `app_settings` · `clients` → `cases` → `letters` → `letter_versions`
(immutable) → `mailing_packets` (immutable once approved) → `mailings` (one per packet) →
`mailing_events`; `documents`, `letter_attachments`, `case_notes`, `responses` (linked to case and
optionally a mailing), `follow_ups`, `audit_events` (append-only), `provider_connections`,
`provider_api_log`. Child tables carry `client_id` with composite foreign keys, so the database
refuses any attachment, response or mailing linked to another client's record.

Statuses are separate columns: case status, letter/document status, packet status, mailing status,
delivery status and response status — plus the provider's raw status stored verbatim.
