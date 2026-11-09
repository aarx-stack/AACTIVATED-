# Put the real app online (Render)

This puts the actual AACTIVATED AI Brain online from this GitHub repository: a working copy you
open in your browser and on your phone. It is the **staging** copy: the demo company, the demo
sign-in picker, every outside service simulated, and a site password in front so only your team
gets in. Nothing is sent to anyone.

## Steps (about 10 minutes, most of it waiting for the first build)

1. Create an account at **render.com** (sign in with GitHub is easiest).
2. In Render: **New > Blueprint**. Connect GitHub when asked and give Render access to the
   `aactivated-stack/AACTIVATED-` repository.
3. Pick the repository and the branch **`claude/affectionate-feynman-cd24bi`** (or `main` once it
   is merged). Render reads `render.yaml` and shows: a database (`aactivated-db`) and a web
   service (`aactivated-ai-brain`).
4. It asks for **SITE_PASSWORD**: type the password your team will use to open the site. Click
   **Apply**.
5. Wait for the first deploy to finish (the build takes a few minutes; the first start creates
   the database and loads the demo company).
6. Open the address Render shows (like `https://aactivated-ai-brain.onrender.com`). The browser
   asks for a user name and password: any user name, and the site password. Then pick a demo
   person to sign in as.
7. On your phone: open the same address, then Safari > Share > **Add to Home Screen** (iPhone) or
   Chrome > **Install app** (Android).

Every new commit to the branch redeploys automatically.

## Cost

`render.yaml` uses Render's free plans, which suit a staging copy: the free web service goes to
sleep after a while without visits (the next visit takes about a minute to wake), and the free
database is temporary (Render deletes free databases after a limited time). For an always-on copy,
switch the web service and database to paid plans in the Render dashboard (currently from about
$7 a month each); check Render's pricing page for current figures.

## For the real company

Do not reuse the staging database. Follow `docs/GO_LIVE.md`: a new database, `APP_ENV=production`,
real email, no demo data (`npm run setup:production`), and the background worker.
