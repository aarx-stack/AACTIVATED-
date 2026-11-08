# AACTIVATED AI Brain

The internal operating system for AACTIVATED RX. An AI CEO ("the Brain") runs a company team of
AI agents across departments and gives every Premium rep a private AI team. **Humans approve
anything that leaves the building.**

> Status: **Phase 6 complete. All 12 pages are built.** Phase 1: setup, design tokens, auth and
> roles, demo data, Command Center, Company Team, Admin. Phase 2: the first end-to-end agent
> workflow, Agent Workspace, Approval & Compliance Queue. Phase 3: rep onboarding, My AI Team,
> Content Studio, Back Office. Phase 4: the 75% budget rule, Finance & Budget, Knowledge Library,
> Prompt Generator. Phase 5: the Development & Tokenization Map, live integration adapters behind
> feature flags (off by default), and browser tests for every page and role in both themes.
> Phase 6: go-live readiness: "Connect QuickBooks" with automatic renewal and encrypted tokens,
> agents that work prompt tasks, sign-in rate limits and production security headers.

## The Phase 2 workflow

On the Command Center, **Give the Brain a task** (executives and staff):

1. **The Brain** plans the request and delegates it to the **Operations Manager**.
2. The Operations Manager writes an assignment and hands it to the **Content Specialist**.
3. The Content Specialist drafts the post: title, caption, hashtags, reasoning and sources.
4. The **compliance engine** checks it against the executive-managed rules
   (`/approvals/rules`). High or critical findings make it an executive decision.
5. The draft enters the **Approval Queue**. A reviewer sees the content with flagged phrases
   highlighted, the compliance findings, and the agent's reasoning and sources, all above the
   **Approve / Edit / Reject** controls. Editing creates a new revision and re-runs compliance.
   Approving a failed check needs a written acknowledgement. Rejecting needs a note.
6. Once approved, the content is **ready to schedule** (scheduling arrives with the Content
   Studio in Phase 3).

Every step writes an AuditLog entry with a shared correlation ID, shown as the audit trail on the
request page. Paused or misconfigured agents stop the workflow safely: the task is marked
blocked, the stop is audited, and nothing is sent.

`AGENT_EXECUTION=inline` (the default) runs the agents during the request.
`AGENT_EXECUTION=queue` hands them to the background worker (`npm run worker`), which is
recommended in production.

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

| Command                    | What it does                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Development server                                                                                 |
| `npm run worker`           | Background worker (pg-boss): heartbeat, health checks, queued agent work                           |
| `npm run check`            | Type-check, lint, format check and all Vitest suites                                               |
| `npm test`                 | Unit and integration tests (integration needs the test database)                                   |
| `npm run test:unit`        | Unit tests only (no database)                                                                      |
| `npm run test:e2e`         | Playwright against a production build (`npm run build` first): every page, every role, both themes |
| `npm run quickbooks:check` | Offline check that "Connect QuickBooks" is set up; prints the redirect address to register         |
| `npm run secret`           | Prints a new random 32-byte key (for `AUTH_SECRET` or `TOKEN_ENCRYPTION_KEY`)                      |
| `npm run db:reset`         | Drop, re-migrate and re-seed the **dev** database                                                  |

Integration tests rebuild the database in `TEST_DATABASE_URL` from migrations on every run. They
refuse to touch any database whose name doesn't end in `_test`.

## The 75% budget rule (Phase 4)

Every budget covers one kind of spend (AI models, advertising, software, contractors) for a
period, company-wide or for one department. The rule lives in `src/server/budgets/`:

1. **Below 75%** of the limit, spend is recorded against its budget as usual.
2. **At 75%** the budget locks. Executives get an in-app alert (and a Slack message, mock by
   default), the event is audited, and the system opens one **"More spending: …"** request in the
   Approval Queue. Further spending in that budget is refused, including the agents' model calls:
   an agent whose AI budget is paused stops with a clear message and nothing is spent.
3. A purchase that would take a budget past 75% is refused **before** it happens, with a link to
   the request.
4. When an executive **approves** the request, spending can continue up to the approved amount;
   the budget locks again when that is used up. Approved purchase requests (for example an agent's
   "Spend: …" request) are recorded once, by an executive, from the Approval Queue or Finance.
5. Executives can also change a limit, with a reason that is kept in the audit log.

The rule's arithmetic is a pure function (`rules.ts`) with unit tests; the database side is
covered by integration tests in `tests/integration/budgets.test.ts`.

### Budget limit changes

Staff open **Budgets** (`/budgets`, linked from the Command Center's AI spend card and the Approval
Queue). It shows each current budget's limit and how much is used, with no transactions or revenue,
and no budgets of confidential departments. Staff can **request a limit change** with a reason; it
becomes an executive request in the Approval Queue (one open request per budget). When Guy
approves, the new limit applies at once and the budget's status is recomputed, so raising a paused
budget's limit can let spending continue. If the limit changed after the request was made, the
approval is refused and nothing changes. The requester is notified either way. Executives still
change limits directly in Finance & Budget with a note; any other executives are notified.

## Knowledge Library and Prompt Generator (Phase 4)

- **Knowledge Library** (`/knowledge`): search, categories, access tags (Executive Only,
  All Staff, Everyone) and an AI summary panel written by the Brain. Access is filtered in the
  database query, so a document a role may not read never reaches the browser, search results,
  counts or the detail page. Legal research is always executive-only. Staff can add documents;
  only executives can add executive-only ones.
- **Prompt Generator** (`/prompts`, executives and staff): chat with the Brain to draft or improve
  a template, fill its `{{variables}}`, keep an append-only version history (restoring copies an
  old version forward), and **Send to Agent**, which puts the filled-in prompt on a company
  agent's task board. Prompts stay inside the company.

## How the rules are enforced

| Rule                                             | Where                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role-based access, enforced on the server        | `src/server/authz/permissions.ts`: one matrix used by every page, action and the Admin matrix                                                                                        |
| Legal, accounting and HR executive-only          | Permissions plus `policies.ts`. Confidential agents and activity are redacted server-side                                                                                            |
| Free reps get Coach and earnings only            | `rep_pod.coach` and `back_office.view_own`; asserted cell by cell in `tests/unit/authz.test.ts`                                                                                      |
| Who can approve what                             | `src/server/approvals/policy.ts`: staff decide low/medium content; executives decide spend, legal, launches and high risk; nobody approves their own request                         |
| Two people before anything leaves                | The person who asked for content (or started the agent workflow) and the person who last edited it cannot approve it; outbound sends are claimed before sending, so they happen once |
| Audit log is append-only                         | A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` (see the init migration)                                                                                                |
| Every change is audited                          | `recordAudit()` runs inside the same transaction as the change                                                                                                                       |
| Every model call is costed                       | `runModel()` writes a `SpendEvent` with agent, model, tokens and USD                                                                                                                 |
| Budgets lock at 75% until approved               | `src/server/budgets/`: `gateSpend()` before every model call and purchase; alerts executives and opens an approval request                                                           |
| Budget limits change through the Approval Queue  | `src/server/budgets/change-requests.ts`: staff request on `/budgets`, an executive approves; applied only if the limit has not changed since the request                             |
| Confidential documents stay on the server        | `src/server/knowledge/service.ts` filters by access level in the database query                                                                                                      |
| Tokenization not launchable without an executive | `src/server/roadmap/policy.ts`: every step gated, decided with a written note; applied only by an approval or an executive decision                                                  |
| Live integrations off by default                 | `src/server/integrations/index.ts`: feature flag + credentials + Admin off switch, checked on every call                                                                             |
| Stored credentials are encrypted                 | `src/server/crypto/secrets.ts`: AES-256-GCM with `TOKEN_ENCRYPTION_KEY`; tokens never appear in the UI or the audit log                                                              |
| Sign-in emails are rate limited                  | `src/server/security/rate-limit.ts`: 5 emails per address and 20 requests per network address every 15 minutes, same answer for every address                                        |
| Always-on                                        | `/api/health`, public `/status`, and error boundaries. A failing integration degrades, never takes the portal down                                                                   |

The outbound gate, `assertDispatchable()` in `src/server/approvals/service.ts`, is the only path
out of the building. It refuses anything that isn't approved, or whose content fingerprint
changed after approval. Spending has its own gate, `gateSpend()` in
`src/server/budgets/service.ts`, which every model call and recorded purchase passes through.

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

## Development & Tokenization Map (Phase 5)

`/roadmap` shows each project as a row moving through **Idea, Build, Review, Launch**, with an
ideas backlog, key metrics and overall progress. The rules are in `src/server/roadmap/policy.ts`:

- Staff add ideas, put them on the map and move ungated projects forward.
- A move is **gated** when the project is locked, when it is the tokenization platform, or when
  it goes to Launch and needs executive approval. Staff request it; the request appears in the
  Approval Queue and the card shows **Pending Approval**. Approving needs a written note and
  applies the move; rejecting clears it.
- Executives can decide a gated move from the map, again only with a written note.
- **The tokenization platform is mapped but not launchable without executive approval.** It stays
  locked after every step, so each step needs a new executive decision, and the note asks for the
  legal review.

## Integrations

GoHighLevel, QuickBooks and Slack sit behind interfaces in `src/server/integrations`. **Mock
adapters are the default and make no external calls.** Live adapters are in
`src/server/integrations/live` and use plain `fetch` (no extra dependencies):

| Integration | Live adapter does                                                                 | Needs                                                                          |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GoHighLevel | Schedules approved posts (Social Planner) and sends approved follow-ups           | `GOHIGHLEVEL_API_KEY`, `GOHIGHLEVEL_LOCATION_ID` (+ `_COMPANY_ID`)             |
| QuickBooks  | **Read-only**: imports purchases, sales receipts, payments and refunds            | `QUICKBOOKS_CLIENT_ID`, `_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, then Connect |
| Slack       | Posts internal alerts (for example, a budget reaching 75%) to an incoming webhook | `SLACK_WEBHOOK_URL`                                                            |

Three switches protect every call:

1. **Feature flag**: `INTEGRATION_<NAME>=live` in the server environment. Default is `mock`.
2. **Credentials**: live mode without its credentials reports DOWN and refuses every call.
3. **Admin off switch**: a system admin can turn any integration off in Admin; every call is then
   refused before anything is sent. Turning it off or on is audited.

Outbound actions still pass the approval gate first: nothing is posted or sent unless an approved,
unchanged request exists. Failures (timeouts, refused credentials, rate limits) show a readable
message and never take the portal down. The adapters are tested against a simulated HTTP layer in
`tests/unit/integrations-live.test.ts`; nothing in the test suite contacts a real service.

**Before switching any integration to live** (needs your approval):

- Use a sandbox first: a GoHighLevel test location and a QuickBooks sandbox company.
- GoHighLevel: confirm the Social Planner and Conversations request fields in
  `live/gohighlevel.ts` against the current HighLevel API reference, connect the social accounts
  in each rep's sub-account, and link contacts to their GoHighLevel ids (live sends refuse
  contacts without one).
- QuickBooks: create an app in the Intuit developer portal, register the redirect URI
  `<APP_URL>/api/integrations/quickbooks/callback`, and set `QUICKBOOKS_CLIENT_ID`,
  `QUICKBOOKS_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`. Then a system admin or executive clicks
  **Connect QuickBooks** in Admin (see below).
- Keep secrets in the hosting environment's secret store, never in the repository.

To simulate an outage with the mocks, set `MOCK_INTEGRATIONS_DOWN=SLACK,QUICKBOOKS`.

### Connect QuickBooks (Phase 6)

With QuickBooks in live mode and the Intuit app configured, Admin shows **Connect QuickBooks** to
executives and system admins. It sends them to Intuit to approve, and back to the app, which:

- checks a one-time state value tied to that browser and that user (forged or replayed callbacks
  are refused and nothing is stored);
- stores the access and refresh tokens **encrypted** (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`). They
  are never shown in the app or written to the audit log; the audit records only which company
  was connected, and executives are notified;
- renews access automatically a few minutes before it expires. Refresh tokens rotate, so renewal
  runs under a database row lock and two requests never spend the same one. If QuickBooks refuses
  the renewal, the app says to connect again.

**Disconnect** revokes the token at Intuit and deletes it here (it is deleted here even if Intuit
cannot be reached). Intuit has no read-only permission scope, so read-only is enforced in code: the
adapter only issues GET requests, and tests check that.

Step-by-step test with Intuit's sample company on your own computer:
[docs/quickbooks-test-company.md](docs/quickbooks-test-company.md). `npm run quickbooks:check`
checks the setup without contacting Intuit.

For a quick sandbox test without the app, `QUICKBOOKS_REALM_ID` and `QUICKBOOKS_ACCESS_TOKEN` still
work, but nothing renews that token.

## Prompt tasks (Phase 6)

**Send to agent** in the Prompt Generator now has the agent do the work. It writes an internal
draft (summary, the draft itself, next steps), the task moves to **In Review** on the agent's task
board, and a person opens **View draft** and clicks **Mark done**. If the agent cannot finish (it
is paused, or its budget is locked at 75%), the task is **Blocked** with the reason and a **Try
again** button. The draft never leaves the company: anything meant for outside still goes through
the Approval Queue. Model spend goes through the budget gate like every other call. With
`AGENT_EXECUTION=queue` the work runs in the background worker instead of during the request.

## Departments and personal assistants

The company has 13 departments, each with its own AI agents (20 company agents plus the Brain):
Operations, **Sales**, Affiliate Success, Marketing, **Publishing**, Social Media, Media, Finance,
Legal & Compliance, Support, Technology, Development and Human Resources.

- **Sales**: Clinic Partnerships Manager, Sales Development Representative and Sales Operations
  Analyst. Consented inbound leads only: no scraping, purchased lists, cold DMs, follows or
  comments.
- **Publishing**: Managing Editor, Staff Writer, Book & E-book Author and Copy Editor, with prompt
  templates for an article draft, an e-book outline and a book chapter. Drafts can be article or
  chapter length. Publishing anything outside the company still needs approval.

**Personal assistants.** Every executive, staff member and system admin has one ("My assistant" on
the Command Center). It is created when someone is invited or moved into a company role, and
paused (history kept) when they leave one or are suspended. Only its owner gives it work and
accepts its drafts; executives can look at staff assistants, never at another executive's. Its
work stays out of the shared activity feed, and its model spend goes through the budget gate.

## Publishing

**Content Studio, Publishing** (`/content/publishing`, executives and staff). Articles, books and
e-books are written part by part:

- **New publication:** title, type (article, e-book, book), audience and a description. Tick
  **Outline it with AI** and the Book & E-book Author (or the Staff Writer, for articles) proposes
  the chapters or sections, each with a short summary to edit.
- **Writing:** pick a part, then **Write with AI** (with an optional note for the writer) or type
  it yourself. Parts can be added, reordered and deleted; word counts update as you go.
- **Approval:** **Send for approval** needs every part written, runs the compliance check on the
  whole text and asks an executive. Editing is locked while it waits. Approval covers exactly that
  version: any later edit sends it back to drafting.
- **Exports:** **PDF** opens a clean, printable copy (choose "Save as PDF"), and **EPUB**
  downloads an e-book file. Both are marked DRAFT unless the exact approved text is unchanged.
  The EPUB is built with Node's built-in compression; no extra dependencies.

## Email campaigns

**Content Studio, Email campaigns** (`/content/email`). Emails go out through GoHighLevel, only
after approval, and only to people who agreed to receive email.

- **Who:** staff and executives email **Clinics**, **Members** or **Reps**: GoHighLevel contacts
  with the tag `clinic`, `member` or `rep` in the company location. Premium reps email **their own
  consented contacts** through their own GoHighLevel sub-account. Free reps cannot send email.
- **Writing:** write it, or click **Draft with AI** and the Content Specialist (or the rep's
  Content Creator) drafts it from a sentence. Nothing is sent from a draft.
- **Approval:** **Send for approval** runs the compliance check and puts it in the Approval Queue.
  Someone other than the author decides. More than 250 recipients, or a high-risk finding, needs
  an executive. Changing an approved email afterwards blocks sending.
- **Sending:** **Send now** sends once per person (a second click or a retry never sends twice).
  It skips anyone who unsubscribed, is marked do-not-disturb in GoHighLevel, has no email address
  or (for a rep) has opted out, and lists each recipient with the result.
- **Unsubscribe:** every email ends with a signed unsubscribe link to `/unsubscribe` (no sign-in).
  It is honored before every later send, marks the contact do-not-disturb in GoHighLevel (or opted
  out, for a rep's contact), and is audited without storing the address.
- With `AGENT_EXECUTION=queue`, sending runs in the background worker.

Before going live: confirm the contact search (`POST /contacts/search`, tag filter) and
do-not-disturb fields in `live/gohighlevel.ts` against the HighLevel API reference with a test
location, and tag your clinic, member and rep contacts in GoHighLevel.

## Production checklist

- `APP_ENV=production`, a long random `AUTH_SECRET` (`npm run secret`), `APP_URL` on HTTPS and
  `EMAIL_TRANSPORT=smtp`. The app refuses to start in production without these, with demo login
  on, or when `APP_ENV` is missing. Sign-in links always point at `APP_URL`, never at the host a
  request claims.
- Run `npm run build` and `npm start` for the web app, `npm run worker` for the background worker
  (set `AGENT_EXECUTION=queue`), and `npx prisma migrate deploy` before each release.
- Put the app behind a proxy that sets `X-Real-IP` (or appends to `X-Forwarded-For`); the sign-in
  limit per network address uses the address the proxy saw, never the client's own claim.
- Security headers are sent on every page: no framing, no plugins, forms only to this site, and
  HSTS in production.
- Secrets (`AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, API keys) go in the host's secret store. Changing
  `TOKEN_ENCRYPTION_KEY` makes stored connections unreadable; connect QuickBooks again afterwards.

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

The UI follows `design/reference/AARX_GUI_Dark_Style_A_Obsidian_Glass.pdf` (Style A, "Obsidian
Glass"): a deep navy base (`#000b1d`) with light streaks and a noise overlay, a floating glass
sidebar, glass cards with thin electric-blue borders and soft glow, cyan-to-blue gradient fills for
primary actions and progress, and bordered tinted status pills. Labels and numbers in the PDF are
placeholders; the app shows live data in the same layout. A white and silver light theme is kept.
Every color, radius and layout size is a CSS variable in `src/styles/globals.css`, and each user's
theme is saved to their account.
