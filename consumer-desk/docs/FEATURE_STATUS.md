# Feature status — Version 1

Legend: **Implemented** = works with real persistence in connected mode (and in demo mode with
fictional data). **Simulated** = works, but the external effect is simulated and labelled as such.
**Blocked** = cannot be completed without something outside this codebase.

## Implemented

- Private owner sign-in (Supabase Auth, email + password); public sign-up disabled; only the
  configured `OWNER_EMAIL` registered in `public.users` gets access.
- TOTP MFA enrollment and sign-in challenge; database policies require AAL2 once a factor is verified;
  optional `REQUIRE_MFA=true` gate in the app.
- Server-side authorization on every page, server action and route handler; owner-only RLS on every
  table; owner-folder Storage policies; no anonymous access.
- Dispute Command Center with 13 database-derived metrics + "requiring attention", each clickable to
  the exact records behind it; recent activity, recent clients, mailing status summary, connection
  health, last successful status refresh, quick actions.
- Clients (search, tags, archive/restore, JSON export, confirmed permanent delete that keeps mailing
  history), multiple cases per client, coaching/session notes, authorization tracking, last-four-only
  account references, SSN/full-number guardrails.
- Client detail tabs: Overview · Cases · Documents · Letters & Mailings · Notes · Timeline.
- Private document storage (PDF/PNG/JPEG, ≤10 MB, magic-byte type detection, extension match,
  encrypted/malformed PDF rejection, random storage names, authenticated no-store downloads).
- Letter editor: blank or template start, own saved templates, neutral starter templates with
  `[[PLACEHOLDERS]]` (packets are refused until replaced), client-field insertion, editable
  recipient and sender, attachments with reordering, drafts, server-generated letter PDF.
- Complete packet preview: sender, recipient, entire letter + every attachment in order (one
  server-assembled PDF), page count, mailing options, price information (or why none exists).
- Immutable approved packets with PDF hash, packet hash, recipient, options, approval time and
  approver; any change to letter, attachments, address or options invalidates approval.
- Duplicate-send protection (durable pre-submission record, unique packet id + idempotency key in
  the database, disabled button), "Submission outcome unknown" handling with manual reconciliation,
  no automatic resend, "Create new mailing from this packet" (new draft, new approval).
- Mailing records with separate mailing / delivery / response statuses, raw provider status,
  provider reference, tracking (or "Not available for this service"), quote and actual cost fields,
  event history, unresolved conditions, awaiting-funding flag.
- Manual mailing records ("Manually recorded", not API verified) and manual status updates.
- PDF packet download and a **generic** recipient CSV export (not a LetterStream format).
- Dispute Tracker table with all requested columns, 12 filters and search.
- Response Center (awaiting / new / needs review / follow-up required / resolved), uploads,
  links to client/case/outgoing mailing, side-by-side outgoing vs incoming review, mark reviewed.
- Client timeline from the append-only audit log, with provider/simulated events visually distinct
  from owner-entered and automatic events.
- Follow-ups (owner-set reminders; overdue / due today / next 7 days / later / completed). No legal
  deadlines are calculated; nothing is resent or created automatically.
- Analytics (7/30/90 days, all time) from saved records, "Not available" where data is missing,
  weekly charts with table view.
- Audit log for client/case/letter/document/packet/mailing/provider/response/follow-up/export/
  deletion/settings events (identifiers and short summaries only).
- Settings: app name, accent colours, owner profile, default return address, timezone
  (default America/Los_Angeles), mail mode & health (no secret values), export/backup instructions,
  pre-real-use checklist.
- Responsive layout with collapsible sidebar and mobile drawer; reduced-motion support; cheaper
  effects on small screens; printed pages and generated letters are plain black on white.

## Simulated

- **Mock mailing provider** (`MAIL_MODE=mock`): submission, acceptance (optionally "awaiting
  funding"), rejection and timeout outcomes, and owner-triggered simulated events (production,
  mailed, in transit, delivered, delivery exception). Simulated tracking numbers start with `SIM-`.
  No quotes are simulated.
- **Demo data mode**: three fictional clients in server memory; resets on restart.

## Blocked (needs something outside this codebase)

| Item | Blocked by | What unblocks it |
| --- | --- | --- |
| LetterStream connection test | No account API documentation; no credentials | Docs + `LETTERSTREAM_TEST_*` env vars, then implement `verifyConnection()` |
| LetterStream quote / price check | Same | Docs, then implement `quote()` |
| LetterStream PDF proofs | Same | Docs, then add a proof method |
| LetterStream submission (test and live) | Same, plus funding decisions | Docs, credentials, confirmed test behaviour |
| LetterStream status / tracking / Certified tracing | Same | Docs, then implement `status()` |
| First-Class / Certified / return receipt via LetterStream | Account service availability unknown | Docs + account confirmation |
| LetterStream PDF and address-window layout rules | Only in account docs | Adjust `RECIPIENT_BLOCK_TOP` etc. in `src/server/pdf/pdf.ts` |
| Automatic status synchronization | No supported scheduler configured; also needs a documented status API | A Vercel Cron (or Supabase scheduled function) calling a sync job, once status is implemented |
| Final acceptance test steps that touch LetterStream | All of the above | — |

### Final acceptance test — current result

| Step | Status |
| --- | --- |
| Login | ✅ Passed (demo and connected/local Supabase) |
| Create own test client record | ✅ Passed (TEST RECORD via wizard or client form) |
| Create test case | ✅ Passed |
| Create letter | ✅ Passed |
| Generate PDF | ✅ Passed |
| Preview complete mailing packet | ✅ Passed |
| Approve packet | ✅ Passed |
| See LetterStream price/quote if supported | ⛔ Blocked — LetterStream docs/credentials not supplied |
| Manually authorize test submission | ✅ Passed with the mock provider |
| Submit through the documented LetterStream integration | ⛔ Blocked — no documented integration available |
| Receive and save the provider reference | ⚠️ Simulated only (`MOCK-…`); not a LetterStream reference |
| View the mailing in Dispute Tracker | ✅ Passed |
| Refresh its real provider status | ⛔ Blocked — mock refresh works; real status not implemented |
| View available tracking information | ⚠️ Simulated only |
| Manually record/upload a response | ✅ Passed |
| See the response counters update | ✅ Passed |
| Create a follow-up | ✅ Passed |
| See complete history on the client timeline | ✅ Passed |

**The acceptance test is NOT passed** for the LetterStream steps. They are isolated and clearly
labelled in the app; everything else runs today.
