-- 0008_order_financials.sql
-- Per-order financial ledger. One row per order (order_id is UNIQUE).
--
-- Component definitions (see docs/FINANCIAL_MODEL.md for the full derivation):
--   gross_revenue  = subtotal - discounts
--   net_revenue    = gross_revenue - refunds
--   product_cogs   = Σ line_cogs, where line_cogs uses the LANDED cost snapshot
--                    (base supplier cost + logistics allocation)
--   logistics_cost = the logistics share already INSIDE product_cogs, stored so
--                    dashboards can display it separately
--   gross_profit   = net_revenue - product_cogs
--   net_profit     = gross_profit - merchant_processing_fee (0 while NOT_CONFIGURED)
--                    - total_affiliate_expense
--
-- Double-count guards, enforced by the calculator and documented here:
--   * logistics is subtracted exactly once — inside product_cogs. logistics_cost
--     is display-only and is never subtracted again.
--   * refunds are subtracted exactly once — inside net_revenue. The refunds
--     column is display-only.
-- merchant_processing_fee stays NULL and merchant_fee_status = 'NOT_CONFIGURED'
-- until real processor terms are configured in organization_settings; no fee is
-- ever invented.

CREATE TABLE order_financials (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations (id),
  order_id                    uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  currency                    text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  gross_revenue               numeric(18,6) NOT NULL DEFAULT 0,
  discounts                   numeric(18,6) NOT NULL DEFAULT 0,
  net_revenue                 numeric(18,6) NOT NULL DEFAULT 0,
  product_cogs                numeric(18,6) NOT NULL DEFAULT 0,
  logistics_cost              numeric(18,6) NOT NULL DEFAULT 0,
  merchant_processing_fee     numeric(18,6),
  merchant_fee_status         text NOT NULL DEFAULT 'NOT_CONFIGURED'
                                CHECK (merchant_fee_status IN ('NOT_CONFIGURED',
                                                               'CONFIGURED')),
  direct_affiliate_commission numeric(18,6) NOT NULL DEFAULT 0,
  mlm_commission              numeric(18,6) NOT NULL DEFAULT 0,
  total_affiliate_expense     numeric(18,6) NOT NULL DEFAULT 0,
  refunds                     numeric(18,6) NOT NULL DEFAULT 0,
  gross_profit                numeric(18,6) NOT NULL DEFAULT 0,
  net_profit                  numeric(18,6) NOT NULL DEFAULT 0,
  net_margin                  numeric(9,6),
  cogs_status                 text NOT NULL DEFAULT 'COMPLETE'
                                CHECK (cogs_status IN ('COMPLETE',
                                                       'PARTIAL_PRICE_NEEDED')),
  calculation_version         text NOT NULL DEFAULT 'v1',
  calculated_at               timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_financials_order_unique UNIQUE (order_id),
  CONSTRAINT order_financials_fee_status_consistent
    CHECK ((merchant_fee_status = 'CONFIGURED') = (merchant_processing_fee IS NOT NULL))
);

CREATE INDEX order_financials_org_idx ON order_financials (organization_id, calculated_at DESC);

CREATE TRIGGER order_financials_set_updated_at
  BEFORE UPDATE ON order_financials
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();
