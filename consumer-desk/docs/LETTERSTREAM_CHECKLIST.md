# LetterStream connection checklist

Source of everything known so far: LetterStream's public page <https://www.letterstream.com/api/>
(reviewed 2026-09-30). It says:

- API access is granted per account: create an account, then email **support@letterstream.com**
  from the account's email address with a short company overview, what you will send, estimated
  volume/frequency and which API mode fits (for your own mailings that is **Automation mode**).
- After approval LetterStream "enable[s] API access for your account (including test)" and shares
  the documentation, which "appear[s] in your LetterStream account under 'My Account'".
- Announced calls: send one letter or a batch; letters, postcards, Certified Mail and Flats; price
  check; PDF proofs; mailing status; Certified tracing; Certified signature; return envelopes;
  paper colour.
- Input formats: PDF documents and CSV address files.
- Jobs submitted via API **are not processed until paid**; accounts can be pre-funded.
- API partners must capture and handle every API response (success or failure).

Not public, therefore **not implemented or guessed**: endpoint URLs, authentication, request and
response fields, status vocabulary, webhooks, idempotency, cancellation, test-mode behaviour
(whether it prints or charges), PDF requirements and address-window layout.

## What you need to do

1. [ ] Create (or use) your LetterStream account.
2. [ ] Email support@letterstream.com from that address requesting API access (Automation mode).
3. [ ] After approval, download/save the API documentation from **My Account**.
4. [ ] Get **test** credentials. Put them only in server environment variables:
       `LETTERSTREAM_TEST_API_ID`, `LETTERSTREAM_TEST_API_KEY`, `LETTERSTREAM_TEST_BASE_URL`
       (rename if the documentation uses different credential types).
5. [ ] Ask LetterStream in writing: does test access create physical mail? Does it charge?
6. [ ] Confirm which services your account can use: First-Class, Certified, return receipt
       (electronic or green card), tracking for each, and whether there is a quote/price check,
       proof retrieval, a non-mailing "verify connection" call, cancellation and idempotency.
7. [ ] Confirm PDF requirements (page size, margins, fonts, max pages/size, address window,
       whether an address page is added) and how a recipient is supplied (in-PDF vs CSV fields).
8. [ ] Decide on funding yourself. Consumer Desk never funds an account or buys postage.

## What gets implemented once the docs arrive

In `src/server/mail/letterstream-provider.ts` (and nowhere else):

- `verifyConnection()` — only a documented, **non-mailing** call. The UI shows "Verified" only after it succeeds.
- `quote()` — if a price check exists; approval then requires a current quote, and a price change
  at send time invalidates the approval automatically.
- `submit()` — map documented success / definite rejection / everything else → `accepted` /
  `rejected` / `unknown`. Use provider idempotency only if documented.
- `status()` — map provider statuses to the normalised statuses **only where unambiguous**; keep the
  raw status; never mark "mailed" or "delivered" unless the provider says so.
- Set each capability to `supported: true` with the documentation section as its `basis`.
- Adjust address placement in `src/server/pdf/pdf.ts` to the documented layout.
- Add tests that mock the documented HTTP responses (no real calls in automated tests).

Then, in **provider test mode** (`DATA_MODE=supabase`, `MAIL_MODE=provider_test`), run the
LetterStream Test Center wizard with your **own** name and address. The app warns
"THIS ACTION MAY CREATE A REAL MAILING AND INCUR A CHARGE." and requires manual confirmation.

Only after a successful test, and only by your explicit choice, set `MAIL_MODE=live` **and**
`LIVE_MAILING_ENABLED=true`, add `LETTERSTREAM_LIVE_*` credentials, and redeploy. The app never
moves from test to live by itself.

## Until then

- Use mock mode to rehearse the workflow (including timeouts and rejections).
- To mail through LetterStream's website: approve the packet, **Download packet PDF**, upload it on
  LetterStream yourself, then **Record it manually** on the packet page (labelled "Manually
  recorded", not "API verified"). The generic recipient CSV is **not** a verified LetterStream import format.
- The app does not automate the LetterStream website.
