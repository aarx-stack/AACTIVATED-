# AACTIVATED RX — Task Scoreboard 🏀

**Live site:** <https://aarx-stack.github.io/AACTIVATED-/>

A team task-management dashboard with a professional basketball-arena scoreboard,
styled as a futuristic pharmacy-operations console: deep navy, electric-blue neon,
and an AACTIVATED RX title crowned with subtle animated electricity. Completing a
task requires entering your initials — then a basketball is shot into the hoop on
the scoreboard, and the moment it drops through the net your score counts up.
**One shot = one completed task = one point.**

## Features

- **Neon brand header** — "Home" eyebrow over a dominant AACTIVATED RX wordmark
  with blue neon glow, an energy-sweep underline and randomly flickering
  electric bolts (all disabled under reduced motion)

- **Arena scoreboard** at the top: LED-style (DSEG7) score digits with ghost
  segments for JG / IM / GG, a live 12-hour clock (AM/PM), a team-total
  ticker, and an integrated backboard + rim + net
- **Basketball scoring animation** — on completion the ball arcs from where you
  clicked into the hoop (spin, motion trail, net snap, SWISH flash, "+1" chip,
  odometer-style score roll). Shots queue safely; every code path commits the
  completion exactly once
- **Task board** with New / Medium / Hot / Completed columns (plus Orders /
  Completed Orders lanes for store orders), live counts, automatic permanent
  ticket numbers (#1001, #1002, …), optional assignment to JG / IM / GG,
  search (ticket, title, notes, initials), drag & drop between active
  columns, and an accessible "move to…" menu on each card's category chip.
  Every card shows when it was created and, while open, how long it has
  been sitting ("Created Today 2:15 PM · 3h 5m ago", updated live). All
  times are 12-hour regardless of the browser's language. Columns stay
  short: Completed and Completed Orders show only the most recent finish,
  task columns their 3 newest (set per column via `preview` in
  `app/config.js`), each with a "Show N more" dropdown that opens the whole
  list in its own scroll box; search always shows every match
- **Edit & review**: the pencil next to each card's trash icon opens Edit
  Task (title, notes, category, assignee). Completion details — who scored,
  when, time spent — stay locked, so an edit can never change the
  scoreboard. Notes keep their line breaks on the card, long ones get a
  Show more toggle, and the completion popup shows them in full
- **Completion flow**: click a task → enter initials (normalized, validated
  against the roster) and how long it took (quick chips or free text: `45m`,
  `1h 30m`, `1:30`, plain minutes) → green Complete Task → shot → task records
  `completedBy` + `completedAt` + `timeSpentMinutes` + a unique `shotId`.
  Dragging a card onto Completed opens the same flow — it can never be bypassed
- **Derived scoreboard**: scores are always computed from the stored tasks
  (`count of completed tasks per player`), so deleting a completed task
  immediately lowers that player's total and a refresh always reconstructs the
  right numbers
- **Storage** (`app/store.js` + `app/backend.js`), best available at startup:
  1. *claude.ai artifact*: the artifact's shared realtime database — live
     updates, lease-guarded unique tickets, one-time migration of this
     browser's existing tasks.
  2. *Supabase* (when `SUPABASE` in `app/config.js` is filled in): one shared
     Postgres-backed board for **anyone who opens the site** — plain REST, no
     SDK, light polling (5s + instant after every action and on tab focus),
     atomic ticket numbers via an `UPDATE … RETURNING` function, same one-time
     migration. Set up a free project with `supabase-setup.sql` (SQL Editor →
     paste → Run), then copy Project Settings → API → Project URL + anon
     public key into the config. Both values are publishable; the RLS
     policies in the setup script are the access boundary — the board is
     deliberately open to anyone with the link.
  3. Neither: per-browser `localStorage` with multi-tab sync.
- **Accessibility**: keyboard shortcuts (`/` search, `n` new task), focus
  management in modals, live-region score announcements, labelled controls, and
  a reduced-motion mode that skips the flight but keeps every update
- Optional synthesized swish/score sounds (Web Audio, no files) with a
  persistent mute toggle on the scoreboard
- **Automatic email notifications** (optional) — see below

## Running

No build step and no dependencies — serve the folder and open it:

```sh
python3 -m http.server 8000
```

then visit <http://localhost:8000>. (ES modules need http(s); opening
`index.html` directly from disk won't load scripts.)

## Team roster

Add or change team members in `app/config.js` (`PLAYERS`) — the scoreboard,
initials validation and the quick-pick buttons all derive from that list.

## Email notifications

Automatic emails on task events, with no backend. Configure
`EMAIL_NOTIFICATIONS` in `app/config.js`:

```js
export const EMAIL_NOTIFICATIONS = {
  recipients: ['you@example.com'],   // who gets the emails
  notifyOn: { completed: true, created: false, deleted: false },
  webhookUrl: '',                    // optional: POST JSON here instead
};
```

- With `recipients` set, emails are delivered through
  [FormSubmit](https://formsubmit.co) (free, no account). The **first**
  notification sends each recipient a one-time activation email — click
  "Activate" once and all later notifications arrive normally.
- With `webhookUrl` set, the app instead POSTs the event as JSON
  (`{ event, subject, message, task, scores, teamTotal, at }`) to your own
  endpoint (Zapier / Make / n8n / custom), which can then send email however
  you like. FormSubmit is skipped in this mode.
- Left unconfigured (the default), no network calls are made. Sending is
  fire-and-forget: a failed email can never affect tasks or scores.

**Orders → tasks (Sellavi webhook)**: `supabase/functions/sellavi-order/`
is a Supabase Edge Function that turns store-order webhooks into board
tasks — idempotent per order, atomic ticket numbers, optional Slack
announcement. Deploy it in the Supabase dashboard (Edge Functions →
Deploy new function, name `sellavi-order`, paste the file, **Verify JWT
OFF**), set secrets `HOOK_KEY` (shared secret) and optionally
`SLACK_WEBHOOK_URL`, `ORDER_CATEGORY` (new|medium|hot), `ORDER_ASSIGNEE`
(initials). Then point the store's "order created" webhook at
`https://<project-ref>.functions.supabase.co/sellavi-order?key=<HOOK_KEY>`.
The mapper reads common payload shapes (order number, customer, items,
total) and falls back gracefully on unknown ones.

**Slack**: `SLACK_NOTIFICATIONS` in `app/config.js` posts task events to a
Slack channel (e.g. `#task_board`) via an Incoming Webhook — create one at
<https://api.slack.com/apps> (New App → Incoming Webhooks → On → Add New
Webhook → pick the channel) and paste the `https://hooks.slack.com/…` URL.
Same per-event toggles and fire-and-forget rules; only the device that
performed the action posts, so shared boards never double-post.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Shell: fonts, styles, `#app` mount |
| `app/config.js` | Roster, statuses, storage keys, email-notification settings |
| `app/backend.js` | Shared realtime storage adapter (claude.ai artifact database) |
| `app/notify.js` | Automatic email notifications (FormSubmit or webhook) |
| `app/store.js` | Source of truth: tasks, persistence, derived scores, completion locks |
| `app/shot.js` | ShotDirector: queued flight animation + exactly-once scoring commit |
| `app/sound.js` | Optional Web Audio swish/score effects |
| `app/dom.js` | Element builder, icon set, basketball SVG |
| `app/components/` | BrandHeader, Scoreboard, ScoreboardPlayer, HoopStage, TaskBoard, TaskColumn, TaskCard, SearchBar |
| `app/components/modals/` | Create / Edit / Complete / Delete dialogs (native `<dialog>`); `taskFields.js` holds the fields Create and Edit share |
| `styles/` | tokens · base · header · scoreboard · board · modals |
| `assets/fonts/` | Self-hosted DSEG7 + Rajdhani (see license note there) |

Type checking: `npx tsc -p jsconfig.json` (JSDoc + `checkJs`, strict).

## Data model

```js
{
  id, ticketNumber, title, notes,
  status: 'new' | 'medium' | 'hot' | 'completed',
  kind: 'task' | 'order', assignedTo,
  createdAt, completedAt, completedBy, timeSpentMinutes, shotId
}
```

Stored under the `aarx.task-scoreboard.v1` key. Ticket numbers start at #1001
and are never reused. The scoreboard is never stored — it is recalculated from
completed tasks on every change, so it can't drift.
