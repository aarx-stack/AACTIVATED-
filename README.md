# Task Scoreboard 🏀

A team task-management dashboard with a professional basketball-arena scoreboard.
Completing a task requires entering your initials — then a basketball is shot into
the hoop on the scoreboard, and the moment it drops through the net your score
counts up. **One shot = one completed task = one point.**

## Features

- **Arena scoreboard** at the top: LED-style (DSEG7) score digits with ghost
  segments for JG / IM / GG, a live clock, a team-total ticker, and an integrated
  backboard + rim + net
- **Basketball scoring animation** — on completion the ball arcs from where you
  clicked into the hoop (spin, motion trail, net snap, SWISH flash, "+1" chip,
  odometer-style score roll). Shots queue safely; every code path commits the
  completion exactly once
- **Task board** with New / Medium / Hot / Completed columns, live counts,
  automatic permanent ticket numbers (#1001, #1002, …), search (ticket, title,
  notes, initials), drag & drop between active columns, and an accessible
  "move to…" menu on each card's category chip
- **Completion flow**: Complete → enter initials (normalized, validated against
  the roster) → shot → task records `completedBy` + `completedAt` + a unique
  `shotId`. Dragging a card onto Completed opens the same initials flow — it can
  never be bypassed
- **Derived scoreboard**: scores are always computed from the stored tasks
  (`count of completed tasks per player`), so deleting a completed task
  immediately lowers that player's total and a refresh always reconstructs the
  right numbers
- **Persistence** in `localStorage` (versioned schema, self-healing load,
  multi-tab sync); swap `load()`/`save()` in `app/store.js` to move to a real
  backend later
- **Accessibility**: keyboard shortcuts (`/` search, `n` new task), focus
  management in modals, live-region score announcements, labelled controls, and
  a reduced-motion mode that skips the flight but keeps every update
- Optional synthesized swish/score sounds (Web Audio, no files) with a
  persistent mute toggle on the scoreboard

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

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Shell: fonts, styles, `#app` mount |
| `app/config.js` | Roster, statuses, storage keys, validation helpers |
| `app/store.js` | Source of truth: tasks, persistence, derived scores, completion locks |
| `app/shot.js` | ShotDirector: queued flight animation + exactly-once scoring commit |
| `app/sound.js` | Optional Web Audio swish/score effects |
| `app/dom.js` | Element builder, icon set, basketball SVG |
| `app/components/` | Scoreboard, ScoreboardPlayer, HoopStage, TaskBoard, TaskColumn, TaskCard, SearchBar |
| `app/components/modals/` | Create / Complete / Delete dialogs (native `<dialog>`) |
| `styles/` | tokens · base · scoreboard · board · modals |
| `assets/fonts/` | Self-hosted DSEG7 + Rajdhani (see license note there) |

Type checking: `npx tsc -p jsconfig.json` (JSDoc + `checkJs`, strict).

## Data model

```js
{
  id, ticketNumber, title, notes,
  status: 'new' | 'medium' | 'hot' | 'completed',
  createdAt, completedAt, completedBy, shotId
}
```

Stored under the `aarx.task-scoreboard.v1` key. Ticket numbers start at #1001
and are never reused. The scoreboard is never stored — it is recalculated from
completed tasks on every change, so it can't drift.
