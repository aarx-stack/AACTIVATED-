# Security notes and limitations

Consumer Desk has **not** been independently security-audited and makes no claim of legal or
regulatory compliance. What it does:

- Owner-only access enforced in three places: the app (`requireOwner` on every page/action/route),
  PostgreSQL row-level security (`public.is_owner()` on every table, including MFA AAL2 once a
  factor is verified), and Storage policies (owner folder only, private bucket).
- No public sign-up, no public pages besides the sign-in screen, no client-facing accounts.
- The web app never uses the service-role key.
- `Cache-Control: no-store` on all app responses; `noindex`; frame-ancestors restricted; files are
  served with a restrictive CSP and `nosniff`.
- Server actions have Next.js's Origin/Host CSRF check; export route handlers check Origin too.
- Rate limits: sign-in (8 / 15 min / IP), MFA (10 / 15 min), and per-action limits. These are
  in-memory per server instance (not distributed); Supabase Auth adds its own limits.
- Minimal logs with field allow-listing; no document contents, client details or secrets are logged.
- Audit log is append-only (no update/delete policies + immutable trigger) and stores identifiers
  and short summaries only.
- No documents are sent to any external AI service.

Known limitations before real client use:

- **Uploads are not virus/malware scanned.** Type, size, extension and PDF structure/encryption are
  checked, and files are only served back as downloads/inline with a locked-down CSP. Only open
  files you trust.
- PDFs are parsed with pdf-lib on the server; a crafted PDF could still exploit a parser bug.
- The demo-mode Host check relies on the `Host` header; demo mode is additionally refused in
  production builds and on Vercel. Never deploy with `DATA_MODE=demo`.
- Rate limiting is per instance.
- The sensitive-number guardrail (SSN / card / account numbers) is a pattern check and can miss
  formats or flag false positives.

Checklist before storing real documents: see Settings → "Before using real client documents".
