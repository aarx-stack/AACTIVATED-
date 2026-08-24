# Financial Model

All financial math uses **exact decimal arithmetic** (`data-core/src/money.js`:
BigInt micros at 6 decimal places, matching `numeric(18,6)` columns).
JavaScript floats are rejected at the API boundary — passing a number throws.
Rounding, where an operation cannot be exact, is **ROUND HALF UP at 6dp**;
payout/display rounding to cents happens only at the edge (`roundToCents`).

## Supplier cost model

Supplier list prices are per **kit**; `vials_per_kit = 10` today (data, not a
constant). Two tiers: `SMALL` and `BULK`; AACTIVATED's active tier is **BULK**.
The logistics rate (**0.15** = shipping + labor + storage) is configurable
data: cost-row override → `organization_settings.logistics_rate` default —
never baked into product records.

```
base_cost_per_vial      = active_kit_cost / vials_per_kit
logistics_cost_per_vial = base_cost_per_vial × logistics_rate
landed_cost_per_vial    = base_cost_per_vial + logistics_cost_per_vial
```

Worked example — Retatrutide 10mg (verified by tests to the exact digit):

| | SMALL | BULK (active) |
| --- | --- | --- |
| Kit cost | 153.75 | 129.15 |
| Base cost/vial | 15.375 | **12.915** |
| Logistics (15%) | 2.30625 | **1.93725** |
| Landed cost/vial | 17.68125 | **14.85225** |

Missing supplier prices (e.g. Tesamorelin/Ipamorelin 5mg/5mg has no displayed
price in the wholesale PDF) are stored as `cost_status = 'PRICE_NEEDED'` with
NULL costs — never invented, never borrowed from another strength.

## Historical COGS preservation

Costs are **effective-dated**: repricing closes the old window
(`effective_to`) and opens a new one; overlaps are impossible (exclusion
constraint); nothing is deleted. When an order is processed, the window in
force at `ordered_at` is resolved and its per-vial numbers are **snapshotted**
onto the order item (`unit_base_cost_snapshot`, `unit_landed_cost_snapshot`,
`line_cogs`, plus `product_cost_id` provenance). Replays never overwrite an
existing snapshot. Historical profit therefore never changes when supplier
pricing changes later — verified by the reprice integration test.

## Order financials

Stored per order in `order_financials`; computed by
`data-core/src/financials.js` (pure) via
`src/services/financials.js` (assembly + upsert).

```
gross_revenue = subtotal − discounts
net_revenue   = gross_revenue − refunds
product_cogs  = Σ line_cogs               (landed snapshots: base + logistics)
logistics_cost= Σ (landed − base) × qty    (the share already INSIDE product_cogs)
gross_profit  = net_revenue − product_cogs
net_profit    = gross_profit
                − merchant_processing_fee   (0 while NOT_CONFIGURED)
                − total_affiliate_expense   (direct + MLM, net of reversals)
net_margin    = net_profit / net_revenue    (NULL when net_revenue = 0)
```

This realizes the conceptual formula
`NET REVENUE − COGS − LOGISTICS − FEES − DIRECT − MLM − REFUNDS = NET PROFIT`
with two **double-count guards**, both test-enforced:

1. **Logistics** is subtracted exactly once — inside landed `product_cogs`.
   `logistics_cost` is display-only and never subtracted again.
2. **Refunds** are subtracted exactly once — inside `net_revenue`. The
   `refunds` column is display-only.

Commission expense is derived from the ledger (order → conversions →
commissions), excluding `disapproved`; `REVERSAL` rows carry negative amounts
and net their original bucket down automatically.

## Merchant / payment processing fees

Processor terms are **not confirmed**. `organization_settings.
merchant_fee_percentage` and `merchant_fee_fixed` default to NULL; while NULL,
`order_financials.merchant_processing_fee` is NULL,
`merchant_fee_status = 'NOT_CONFIGURED'`, and net profit treats the fee as 0.
No fee is ever invented. When real terms are configured, the fee is computed as
`gross_revenue × percentage + fixed` and recalculation is idempotent
(`calculation_version` tracks formula revisions).

## COGS completeness

Orders containing a `PRICE_NEEDED` line get
`cogs_status = 'PARTIAL_PRICE_NEEDED'`: their profit is computed from the
priced lines only and flagged as incomplete rather than silently wrong.
Once the supplier price is added (new cost window) the affected orders can be
re-snapshotted deliberately via a documented, audited backfill — never
automatically.
