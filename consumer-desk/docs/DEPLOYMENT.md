# Deployment (Vercel + Supabase)

Nothing in this repository has been deployed. These are the steps for you to run.

1. Complete the Supabase setup in the README (§2.1 – §2.2): project, migrations, sign-ups disabled,
   TOTP enabled, owner created with `npm run create-owner`.
2. In Vercel: **Add New → Project**, import this GitHub repository, and set **Root Directory** to
   `consumer-desk`. The framework preset is detected as Next.js.
3. Environment variables (Production and Preview):

   | Name | Value |
   | --- | --- |
   | `DATA_MODE` | `supabase` (never `demo` — demo sign-in is refused on Vercel anyway) |
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_ANON_KEY` | anon / publishable key (NOT the service-role key) |
   | `OWNER_EMAIL` | your owner email |
   | `REQUIRE_MFA` | `true` once your authenticator is enrolled |
   | `MAIL_MODE` | `mock` |
   | `LIVE_MAILING_ENABLED` | `false` |

4. Supabase → Authentication → URL Configuration: set **Site URL** to your Vercel URL.
5. Deploy, sign in, enroll MFA, set `REQUIRE_MFA=true`, redeploy.
6. Keep the deployment private: consider Vercel **Deployment Protection** (password/SSO) on
   preview deployments, and do not share the URL.
7. Server actions wait up to 30 s for a mail provider; the send pages set `maxDuration = 60`.

Backups: enable Supabase backups / PITR; separately copy the `consumer-desk-private` bucket.

Automatic status sync is **not configured**. When a documented LetterStream status API exists, add
a Vercel Cron job that calls a dedicated, secret-protected sync route (not a browser tab or in-memory timer).
