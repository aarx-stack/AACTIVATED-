# Going live

What has to happen, in order, to run AACTIVATED AI Brain for the real company. Steps marked
**(you)** need your accounts or decisions; everything else is ready in the code.

## 1. Hosting (you)

Pick a host that can run three things: the web app, the background worker and PostgreSQL 16.
Recommended: **Railway** (all three in one place, roughly $5–20 a month at this size).
Alternative: Vercel for the web app plus a managed Postgres (Neon or Supabase) plus a small
worker host, since Vercel cannot run the always-on worker.

- Web: `npm ci && npm run build`, then `npm start`.
- Worker: `npm run worker` (health checks, queued agent work and email sending, and starting each
  month's budgets).
- Database: PostgreSQL 16. Before each release: `npm run db:deploy`.
- Put it behind HTTPS on your domain (for example `brain.aactivatedrx.com`).

## 2. Settings and secrets (you, in the host's secret settings, never in chat or the code)

| Setting                                         | Value                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `APP_ENV`                                       | `production`                                                                               |
| `APP_URL`                                       | the https address, e.g. `https://brain.aactivatedrx.com`                                   |
| `DATABASE_URL`                                  | from the host                                                                              |
| `AUTH_SECRET`                                   | `npm run secret`                                                                           |
| `EMAIL_TRANSPORT`, `EMAIL_SERVER`, `EMAIL_FROM` | `smtp`, your mail provider's SMTP URL, e.g. `AACTIVATED AI Brain <brain@aactivatedrx.com>` |
| `DEMO_LOGIN_ENABLED`                            | `false` (the app refuses to start with it on in production)                                |
| `AGENT_EXECUTION`                               | `queue`                                                                                    |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`              | `anthropic` and your key, when you want the agents to write for real                       |

The app refuses to start in production with a weak `AUTH_SECRET`, console email, plain http or
demo login, and when `APP_ENV` is missing.

## 3. Set up the real company (one command)

On a **new, empty database** (never the demo one):

```bash
npm run db:deploy
SETUP_EXECUTIVE_NAME="Guy Griffithe" SETUP_EXECUTIVE_EMAIL="guy@aactivatedrx.com" \
SETUP_ADMIN_NAME="Isaac Muniz" SETUP_ADMIN_EMAIL="isaac@aactivatedrx.com" \
SETUP_AI_BUDGET_USD=200 npm run setup:production
```

It creates Guy (executive) and Isaac (system admin), the 13 departments, the Brain and the 19
department agents, the rep agent templates, the starter compliance rules, the prompt library,
the integrations (all simulated) and a company AI budget. No demo users, posts, contacts or
transactions. It is safe to run again and refuses a database that holds the demo data.

## 4. First day

1. Guy and Isaac sign in at `/login` with the link emailed to them.
2. **Review the compliance rules** (Approvals > Content rules). The starter terms are
   placeholders: add your real restricted terms and peptide names.
3. **Add budgets** in Finance & Budget > New budget (per department or company-wide). Each budget
   carries over every month with the same limit; spending pauses at 75% until an executive
   approves more.
4. **Invite the team** from Admin. Staff get a personal assistant automatically; Premium reps get
   their four-agent team when they finish onboarding.
5. **Assign department owners** where the setup used Guy as a placeholder.

## 5. Connect the outside services, one at a time (you)

Each stays simulated until switched on, and Isaac can switch any of them off in Admin at once.
Test each with a sandbox or test account first.

| Service                                | You provide                                                                             | Switch on with                                                 | Guide                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Anthropic (AI writing)                 | API key                                                                                 | `AI_PROVIDER=anthropic`                                        | README, "AI"                                 |
| GoHighLevel (posts, follow-ups, email) | Private integration token, location id; tag contacts `clinic`, `member`, `rep`          | `INTEGRATION_GOHIGHLEVEL=live`                                 | README, "Integrations" and "Email campaigns" |
| QuickBooks (read-only)                 | Intuit app client id and secret, encryption key; production keys need the https address | `INTEGRATION_QUICKBOOKS=live`, then Admin > Connect QuickBooks | `docs/quickbooks-test-company.md`            |
| Slack (internal alerts)                | Incoming webhook URL                                                                    | `INTEGRATION_SLACK=live`                                       | README, "Integrations"                       |

Before GoHighLevel goes live I will confirm its request fields against your test location.

## 6. Mailboxes (you, outside this app)

Staff addresses like name@aactivatedrx.com come from your email host (Google Workspace or
Microsoft 365), not from this app.
