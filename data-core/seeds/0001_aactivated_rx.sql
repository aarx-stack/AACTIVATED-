-- 0001_aactivated_rx.sql
-- Seed tenant #1: AACTIVATED RX, its settings, supplier, and the two supplier
-- cost examples that are explicitly known today.
--
-- SAFE TO RE-RUN: every statement is idempotent (ON CONFLICT / WHERE NOT EXISTS).
--
-- PRICING RULE: prices here come from the Wholesale Peptide Supply wholesale PDF
-- as provided by the business. The full catalog import is a separate, reviewed
-- step (docs/RUNBOOK.md) — missing prices are recorded as PRICE_NEEDED, never
-- invented and never borrowed from another strength.

BEGIN;

-- Tenant #1
INSERT INTO organizations (organization_key, name, status)
VALUES ('AACTIVATED_RX', 'AACTIVATED RX', 'ACTIVE')
ON CONFLICT (organization_key) DO NOTHING;

-- Settings: 15% logistics (shipping + labor + storage), BULK tier active,
-- merchant fees deliberately NULL = NOT_CONFIGURED (no processor terms confirmed).
INSERT INTO organization_settings
  (organization_id, default_currency, logistics_rate, default_cost_tier,
   merchant_fee_percentage, merchant_fee_fixed)
SELECT o.id, 'USD', 0.150000, 'BULK', NULL, NULL
FROM organizations o
WHERE o.organization_key = 'AACTIVATED_RX'
ON CONFLICT (organization_id) DO NOTHING;

-- Current supplier
INSERT INTO suppliers (organization_id, supplier_key, name, status)
SELECT o.id, 'WHOLESALE_PEPTIDE_SUPPLY', 'Wholesale Peptide Supply', 'ACTIVE'
FROM organizations o
WHERE o.organization_key = 'AACTIVATED_RX'
ON CONFLICT (organization_id, supplier_key) DO NOTHING;

-- Products (internal SKUs are provisional and org-scoped; external Sellavi ids
-- are mapped later during Sellavi catalog reconciliation).
INSERT INTO products (organization_id, sku, product_name, strength, unit_type, active)
SELECT o.id, p.sku, p.product_name, p.strength, 'VIAL', true
FROM organizations o
CROSS JOIN (VALUES
  ('RETATRUTIDE-10MG',      'Retatrutide',            '10mg'),
  ('TESA-IPA-5MG-5MG',      'Tesamorelin/Ipamorelin', '5mg/5mg')
) AS p(sku, product_name, strength)
WHERE o.organization_key = 'AACTIVATED_RX'
ON CONFLICT (organization_id, sku) DO NOTHING;

-- Cost example 1 — Retatrutide 10mg (known from the wholesale PDF):
--   small kit 153.75, bulk kit 129.15, 10 vials per kit, BULK tier active.
--   logistics_rate NULL -> falls back to the org default (0.15).
-- Derived (computed in code, not stored): base 12.915, logistics 1.93725,
-- landed 14.85225 per vial.
INSERT INTO product_costs
  (organization_id, product_id, supplier_id, cost_status,
   small_kit_cost, bulk_kit_cost, vials_per_kit, active_cost_tier,
   logistics_rate, effective_from, source_reference)
SELECT o.id, p.id, s.id, 'PRICED',
       153.750000, 129.150000, 10, 'BULK',
       NULL, '2026-01-01T00:00:00Z', 'Wholesale Peptide Supply wholesale PDF'
FROM organizations o
JOIN products p  ON p.organization_id = o.id AND p.sku = 'RETATRUTIDE-10MG'
JOIN suppliers s ON s.organization_id = o.id AND s.supplier_key = 'WHOLESALE_PEPTIDE_SUPPLY'
WHERE o.organization_key = 'AACTIVATED_RX'
  AND NOT EXISTS (
    SELECT 1 FROM product_costs pc
    WHERE pc.product_id = p.id AND pc.supplier_id = s.id
  );

-- Cost example 2 — Tesamorelin/Ipamorelin 5mg/5mg: the wholesale PDF shows NO
-- price for this item. Recorded explicitly as PRICE_NEEDED with NULL costs.
INSERT INTO product_costs
  (organization_id, product_id, supplier_id, cost_status,
   small_kit_cost, bulk_kit_cost, vials_per_kit, active_cost_tier,
   logistics_rate, effective_from, source_reference)
SELECT o.id, p.id, s.id, 'PRICE_NEEDED',
       NULL, NULL, 10, 'BULK',
       NULL, '2026-01-01T00:00:00Z',
       'Wholesale Peptide Supply wholesale PDF — no displayed price'
FROM organizations o
JOIN products p  ON p.organization_id = o.id AND p.sku = 'TESA-IPA-5MG-5MG'
JOIN suppliers s ON s.organization_id = o.id AND s.supplier_key = 'WHOLESALE_PEPTIDE_SUPPLY'
WHERE o.organization_key = 'AACTIVATED_RX'
  AND NOT EXISTS (
    SELECT 1 FROM product_costs pc
    WHERE pc.product_id = p.id AND pc.supplier_id = s.id
  );

COMMIT;
