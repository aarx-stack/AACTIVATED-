# Time & boundary semantics

Single source of truth for every date rule in the system. All of this is
implemented in `shared/time.ts` + `shared/challenge.ts` and pinned by
`tests/time.test.ts` and `tests/challenge.test.ts`.

## Storage & clocks

- Every stored instant is **UTC** (ISO-8601 with milliseconds, `Z`).
- The **server clock decides** qualification and window math. Client clocks
  only render countdowns; a skewed client can't change outcomes.
- **America/Los_Angeles** is the reporting timezone: period boundaries and
  every displayed date/time use it (labels show PDT/PST).

## Leaderboard periods (LA wall clock)

| Period | Definition | Key |
| --- | --- | --- |
| Monthly (default) | Calendar month: 1st 00:00:00 LA → next 1st 00:00:00 LA | `2026-09` |
| Weekly | Monday 00:00:00 LA → next Monday 00:00:00 LA | `wk-2026-09-07` |
| All-time | Everything | `all` |

All ranges are half-open `[start, end)`. DST: boundaries follow the LA wall
clock, so a week containing “fall back” is 169 real hours and “spring
forward” 167 — a transaction is always in exactly one period, none is ever
counted twice or dropped.

## Challenge windows (exact durations, not calendar days)

- Enrolled **before** launch → window starts **at launch**.
- Enrolled **on/after** launch → window starts **at enrollment** (the stored
  enrollment instant, not midnight).
- Length = `windowDays × 24h` exactly: 30 days = **720 hours**, independent
  of DST. A window crossing a DST change still lasts exactly 720 hours.
- Window is half-open `[start, end)`:
  - a transaction at the opening instant **counts**;
  - a transaction at the closing instant **does not**;
  - status flips to *Window ended* exactly at `end`.
- The transaction instant that matters is the **source order timestamp**
  (`occurred_at`), not when the webhook arrived.
- No launch date configured → no windows exist; affiliates see
  **“Launch date pending.”** Expired windows never restart automatically.

## Qualification & membership instants

- `qualified_at` — when the path was completed (e.g. the Founders Pack
  order's `occurred_at`, or the sale that crossed $10,000).
- `verified_at` — when verification completed. **Currently the basis for
  both seat priority and the membership start** (pending owner
  confirmation, see DECISIONS_NEEDED). Verification may complete after the
  window closes; the in-window activity still counts (*Pending
  verification* survives window close).
- `membership_expires_at` = `verified_at + 365 × 24h`. At/after that
  instant the status is *Membership expired*.
- Seats are claimed by a single guarded INSERT (worker/domain/seats.ts):
  the 50-cap check, seat number and insert are one atomic statement, so
  concurrent verifications can never overbook (tested with 60 concurrent
  claimants and a 6-way race for the final seat).

## Status precedence (first match wins)

1. Membership exists → **Qualified**, or **Membership expired** after expiry.
2. Pending verification → **Pending verification** (survives window close).
3. All seats verified-claimed → **Capacity reached**.
4. No launch configured, or window not yet open → **Not started**.
5. Window open → **In progress** once any path shows progress, else
   **Not started**.
6. Otherwise → **Window ended**.

## Monthly rankings vs. windows

Deliberately independent: monthly/weekly boards slice by LA periods over
everyone's eligible sales; challenge progress slices each affiliate's own
`[start, end)` window. A sale after your window still ranks in its month; a
sale inside your window that falls in last month still counts toward your
window.
