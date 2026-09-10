# Confirm before production activation

`challenge_config.activated` and `policy_confirmed` stay **off** until the
program owner confirms each item below. The demo uses the documented
defaults, clearly labeled as samples. None of these block the demo or the
integration work.

## 1 · Seat priority & membership start (owner explicitly asked to confirm)

Verification can finish hours or days after a qualifying purchase — which
instant decides who gets one of the 50 seats, and when the one-year
membership starts?

Current build (both = **verification-completion time**):

- Seat order = the order verifications complete (`verified_at`). A slower
  verification can lose a seat race to a later purchase verified sooner.
- Membership year runs from `verified_at`.

Alternative: use the qualifying purchase/path-completion time
(`qualified_at`) for either or both — first-to-qualify keeps priority
regardless of review speed, but seats can then be displaced retroactively
while verifications are pending, which needs a holding rule. **Decide: seat
priority basis, membership start basis.**

## 2 · Eligible-sales policy

Proposed and implemented: verified-paid product revenue − discounts −
refunds, excluding tax and shipping; unpaid/pending (e.g. Zelle) orders
excluded until verified. Confirm, or adjust the policy flags in
`challenge_config.policy_json`.

Two facts from the live account to fold into this decision:
- Tapfiliate reports **one amount per conversion** (no tax/shipping split),
  so “excluding tax and shipping” depends on what the Sellavi integration
  sends — confirm whether that amount is product subtotal or order total.
- Snapshot mode currently counts Sellavi-tracked checkouts and excludes
  Tapfiliate-dis-approved conversions; dashboards also round whole dollars
  ($99.97 shows as $100 — the admin ledger stays exact). Confirm both.

## 3 · Team rollup policy

Sample policy in the demo: **self + verified descendants**, every
transaction counted once per ancestor line; any unverified edge in a
subtree → “Team data not connected.” Confirm: descendants-only instead?
Depth cap? Who verifies edges (Tapfiliate MLM import vs. admin)? Until
confirmed, team qualification cannot activate.

## 4 · Refunds after qualification

Implemented behavior: post-qualification refunds are **flagged for admin
review** (review queue) — membership is never silently revoked. Confirm the
actual policy (grace amount? revoke? clawback?) so reviewers have a rule.

## 5 · Seat total vs. active members

“First 50 verified qualifiers” is implemented as a **lifetime total** — an
expired membership does not free a seat. Confirm, or define seat recycling.

## 6 · Founders Pack identification

The adapter flags packs by SKU (`FOUNDERS-PACK`) / metadata. Confirm the
real SKU/product id in your Sellavi catalog.

## 7 · Launch date

Not chosen — production shows “Launch date pending.” When chosen, set it in
the admin Launch config (audited) as an exact instant (date + time,
Pacific); it converts to UTC per docs/TIME_AND_BOUNDARIES.md.

## 8 · Compensation plan display

No verified plan is configured, so the dashboard shows the honest empty
state. Provide the real tier names/thresholds when ready; rates always come
from the verified Tapfiliate configuration and are never estimated.
