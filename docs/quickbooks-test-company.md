# Connect QuickBooks: try it with a test company

This runs the app on your own computer and connects it to Intuit's **sample (sandbox) company**.
Your real QuickBooks company is not touched. It takes about 20 minutes and costs nothing.

You need: a computer with Node 22.12+ and Docker Desktop, and an Intuit account (the one you use
for QuickBooks works).

## 1. Run the app on your computer

```bash
git clone https://github.com/aarx-stack/AACTIVATED-.git
cd AACTIVATED-
git checkout claude/affectionate-feynman-cd24bi
cp .env.example .env
docker compose up -d
npm install
npm run db:deploy
npm run db:seed
```

Open `.env` and set `AUTH_SECRET` to the output of `npm run secret`.

## 2. Create the Intuit developer app

1. Go to <https://developer.intuit.com> and sign in with your Intuit account.
2. **Dashboard, Create an app**, choose **QuickBooks Online and Payments**, give it a name such as
   "AACTIVATED AI Brain (test)".
3. When asked for permissions (scopes), choose **Accounting** only
   (`com.intuit.quickbooks.accounting`).
4. Open the app's **Keys and credentials** and stay on **Development** (test company) keys.
5. Under **Redirect URIs**, add exactly:
   `http://localhost:3000/api/integrations/quickbooks/callback`
6. Copy the **Client ID** and **Client Secret**.

Intuit creates a sample company for you automatically (developer dashboard, **Sandbox**).

## 3. Tell the app

In `.env`:

```bash
INTEGRATION_QUICKBOOKS=live
QUICKBOOKS_ENVIRONMENT=sandbox
QUICKBOOKS_CLIENT_ID=<Client ID from step 2>
QUICKBOOKS_CLIENT_SECRET=<Client Secret from step 2>
TOKEN_ENCRYPTION_KEY=<output of: npm run secret>
```

Leave `QUICKBOOKS_REALM_ID` and `QUICKBOOKS_ACCESS_TOKEN` empty. Then check, without contacting
Intuit:

```bash
npm run quickbooks:check
```

It lists anything still missing and the redirect address to register. When it says **Ready**:

```bash
npm run dev
```

## 4. Connect and import

1. Open <http://localhost:3000>, sign in as **Isaac Muniz** (System Admin) or **Guy Griffithe**.
2. **Admin**, Integrations, QuickBooks: **Connect QuickBooks**.
3. Intuit asks you to sign in and pick a company: choose the **sandbox** company and approve.
4. You land back on Admin with "QuickBooks is connected (read-only)".
5. Sign in as Guy, open **Finance & Budget** and click **Sync now**. The sample company's
   purchases, sales receipts, payments and refunds appear under Transactions.

To undo: **Admin, Disconnect QuickBooks**. The app only ever reads from QuickBooks.

## When something goes wrong

| You see                                            | What to do                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Intuit says the redirect URI is invalid            | The address in step 2.5 must match `npm run quickbooks:check` exactly, including `http` and port            |
| "QuickBooks connect is not set up"                 | `INTEGRATION_QUICKBOOKS=live` and all three settings are needed; restart `npm run dev` after editing `.env` |
| "The QuickBooks sign-in expired or did not match"  | Start again from the Connect button in the same browser, within 10 minutes                                  |
| "QuickBooks refused the credentials (401)" on sync | Development keys only work with the sandbox company; check `QUICKBOOKS_ENVIRONMENT=sandbox`                 |
| "QuickBooks refused to renew access"               | Disconnect and connect again                                                                                |

## Your real company (later, with approval)

Production keys come from the same Intuit app after Intuit's short app questionnaire, and they
require the app to be hosted on an **https** address. Then: set `QUICKBOOKS_ENVIRONMENT=production`,
the production Client ID and Secret, register `https://<your address>/api/integrations/quickbooks/callback`,
and connect from Admin as above.
