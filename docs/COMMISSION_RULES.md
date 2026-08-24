# Commission Rules

## Operational system of record

**Tapfiliate** computes and approves commissions today (Phase 1/2 — working,
do not modify). The Data Core mirrors every commission as a permanent ledger.
Nothing in Phase 3 changes Tapfiliate settings, MLM percentages, or affiliate
groups.

## Current program (as configured in Tapfiliate)

| Level | Who earns | Rate |
| --- | --- | --- |
| Direct | Selling affiliate | Their personal/group rate |
| MLM level 2 | Seller's sponsor | **3%** |
| MLM level 3 | Sponsor's sponsor | **2%** |

These rates live in Tapfiliate (operational) and arrive in the Data Core as
per-row `commission_rate` values on ledger entries. They are **data, not code
constants** — a future program change creates new ledger rows with new rates
and never rewrites history.

## The ledger principle

One conversion produces **one ledger row per commission**, never a single
collapsed total:

```
conversion tap-conv-1001 ($300 order)
├─ DIRECT       seller          rate 0.20  amount 60.00
├─ MLM_LEVEL_2  sponsor         rate 0.03  amount  9.00
└─ MLM_LEVEL_3  grand-sponsor   rate 0.02  amount  6.00
```

`commission_type` values:

- `DIRECT` — selling affiliate's personal commission
- `MLM_LEVEL_2` / `MLM_LEVEL_3` — override commissions up the sponsor tree
- `BONUS` — discretionary additions
- `MANUAL_ADJUSTMENT` — corrections (positive or negative), with `memo`
- `REVERSAL` — automatic negative counterpart when a commission is reversed

## Statuses

`pending → approved → payable → paid`, with `disapproved` and `reversed` as
exits. Terminal states (`paid`, `reversed`) never regress on webhook replays.

## Corrections are append-only

A reversal (refund, clawback, disapproval after approval):

1. inserts a `REVERSAL` row with the **negative** amount, linked via
   `reversed_commission_id` (database-unique — a commission can be reversed
   exactly once);
2. sets the original row's status to `reversed`;
3. writes an `audit_log` entry with before/after and reason.

Order financials then net the reversal against the original bucket
automatically. Nothing is ever deleted or edited in place.

## Protected affiliates (Phase 2 rule, preserved)

`affiliates.protected_group = true` means tier/group automation must **never**
move that affiliate. `applyGroupChange` (src/services/affiliates.js) enforces
this: the attempt is skipped, the affiliate is untouched, and a
`PROTECTED_GROUP_SKIPPED` automation event records that the guard fired.
Unprotected changes are applied with an `AFFILIATE_GROUP_CHANGED` event and an
audit entry (before/after group).

## Sponsor tree history

`affiliate_relationships` stores effective-dated sponsor edges. Changing a
sponsor closes the current edge (`effective_to`) and opens a new one, so the
MLM tree behind any historical commission can always be reconstructed exactly
as it stood when the commission was earned.

## Idempotency

Webhook replays cannot duplicate earnings:

- Tapfiliate-supplied ids: `(organization_id, external_commission_id)` unique.
- Structural: `(organization_id, conversion_id, affiliate_id, commission_type)`
  unique for DIRECT/MLM rows.
- A second DIRECT for the same conversion+affiliate under a *different*
  external id violates the structural constraint loudly — surfacing a data
  problem instead of silently double-paying.
