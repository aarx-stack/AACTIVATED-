-- 0003_products_suppliers_costs.sql
-- Product master, suppliers, and the effective-dated supplier cost engine.
--
-- Identity rule: products are identified by internal id + org-scoped SKU, never by
-- product name alone. External systems map through external_sellavi_product_id /
-- external_sku.
--
-- Cost rule: supplier list prices are per KIT (10 vials today). Costs are
-- effective-dated (effective_from/effective_to) and never destroyed on reprice,
-- so historical orders keep the cost assumptions that existed when they occurred.
-- Missing supplier prices are represented explicitly (cost_status = 'PRICE_NEEDED'),
-- never invented and never borrowed from another strength.

CREATE TABLE products (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations (id),
  sku                         text NOT NULL,
  product_name                text NOT NULL,
  strength                    text,
  unit_type                   text NOT NULL DEFAULT 'VIAL',
  active                      boolean NOT NULL DEFAULT true,
  external_sellavi_product_id text,
  external_sku                text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_org_sku_unique UNIQUE (organization_id, sku)
);

CREATE UNIQUE INDEX products_org_sellavi_id_unique
  ON products (organization_id, external_sellavi_product_id)
  WHERE external_sellavi_product_id IS NOT NULL;

CREATE INDEX products_org_active_idx ON products (organization_id, active);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  supplier_key    text NOT NULL CHECK (supplier_key ~ '^[A-Z0-9][A-Z0-9_]*$'),
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_org_key_unique UNIQUE (organization_id, supplier_key)
);

CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

-- One row = one supplier price window for one product.
--   small_kit_cost / bulk_kit_cost : supplier list price per kit for each tier.
--   vials_per_kit                  : kit size (supplier lists 10-vial kits today).
--   active_cost_tier               : which tier AACTIVATED buys at (BULK today).
--   logistics_rate                 : optional override; NULL falls back to
--                                    organization_settings.logistics_rate (0.15).
-- Derived per-vial numbers (base/logistics/landed) are computed in code
-- (src/costing.js) with exact decimal arithmetic — not stored here — and are
-- snapshotted onto order_items at order processing time.
CREATE TABLE product_costs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id),
  product_id       uuid NOT NULL REFERENCES products (id),
  supplier_id      uuid NOT NULL REFERENCES suppliers (id),
  cost_status      text NOT NULL DEFAULT 'PRICED'
                     CHECK (cost_status IN ('PRICED', 'PRICE_NEEDED')),
  small_kit_cost   numeric(18,6) CHECK (small_kit_cost IS NULL OR small_kit_cost >= 0),
  bulk_kit_cost    numeric(18,6) CHECK (bulk_kit_cost IS NULL OR bulk_kit_cost >= 0),
  vials_per_kit    integer NOT NULL DEFAULT 10 CHECK (vials_per_kit > 0),
  active_cost_tier text NOT NULL DEFAULT 'BULK'
                     CHECK (active_cost_tier IN ('SMALL', 'BULK')),
  logistics_rate   numeric(9,6) CHECK (logistics_rate IS NULL
                                       OR (logistics_rate >= 0 AND logistics_rate < 1)),
  effective_from   timestamptz NOT NULL DEFAULT now(),
  effective_to     timestamptz,
  source_reference text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_costs_window_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- A PRICED row must actually carry a price for its active tier.
  CONSTRAINT product_costs_priced_has_price
    CHECK (cost_status = 'PRICE_NEEDED'
           OR (CASE active_cost_tier
                 WHEN 'BULK'  THEN bulk_kit_cost
                 WHEN 'SMALL' THEN small_kit_cost
               END) IS NOT NULL),
  -- Never two price windows for the same product+supplier at the same moment.
  CONSTRAINT product_costs_no_overlap
    EXCLUDE USING gist (
      product_id WITH =,
      supplier_id WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

CREATE INDEX product_costs_org_product_idx
  ON product_costs (organization_id, product_id, effective_from DESC);
