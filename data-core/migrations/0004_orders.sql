-- 0004_orders.sql
-- Orders and order items, built for idempotent Sellavi ingestion.
--
-- Idempotency: (organization_id, source, external_order_id) is unique, so replaying
-- the same Sellavi webhook/import can only ever update the one existing row.
-- COGS snapshot rule: unit_base_cost_snapshot / unit_landed_cost_snapshot are copied
-- from the cost window in force when the order is processed. Later supplier
-- reprices must never change historical profit, so these values are frozen here.

CREATE TABLE orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id),
  external_order_id  text NOT NULL,
  source             text NOT NULL DEFAULT 'SELLAVI'
                       CHECK (source IN ('SELLAVI', 'MANUAL', 'OTHER')),
  customer_reference text,
  currency           text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal           numeric(18,6) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total     numeric(18,6) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  gross_revenue      numeric(18,6) NOT NULL DEFAULT 0,
  refund_total       numeric(18,6) NOT NULL DEFAULT 0 CHECK (refund_total >= 0),
  net_revenue        numeric(18,6) NOT NULL DEFAULT 0,
  order_status       text NOT NULL DEFAULT 'PENDING'
                       CHECK (order_status IN ('PENDING', 'CONFIRMED', 'FULFILLED',
                                               'CANCELLED')),
  financial_status   text NOT NULL DEFAULT 'PENDING'
                       CHECK (financial_status IN ('PENDING', 'PAID',
                                                   'PARTIALLY_REFUNDED', 'REFUNDED',
                                                   'VOID')),
  ordered_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_external_id_unique UNIQUE (organization_id, source, external_order_id)
);

CREATE INDEX orders_org_ordered_at_idx ON orders (organization_id, ordered_at DESC);
CREATE INDEX orders_org_financial_status_idx ON orders (organization_id, financial_status);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

-- line_number makes re-ingestion idempotent per line: (order_id, line_number) is
-- the upsert key when a payload is replayed.
-- product_id is nullable so an order whose product is not yet mapped still lands
-- (with external_product_id/sku preserved for later reconciliation).
-- cost_snapshot_status = 'PRICE_NEEDED' marks lines processed while the supplier
-- price was missing; their line_cogs stays NULL rather than being invented.
CREATE TABLE order_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations (id),
  order_id                  uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  line_number               integer NOT NULL CHECK (line_number > 0),
  product_id                uuid REFERENCES products (id),
  external_product_id       text,
  sku                       text,
  quantity                  integer NOT NULL CHECK (quantity > 0),
  unit_sale_price           numeric(18,6) NOT NULL CHECK (unit_sale_price >= 0),
  line_revenue              numeric(18,6) NOT NULL,
  unit_base_cost_snapshot   numeric(18,6) CHECK (unit_base_cost_snapshot IS NULL
                                                 OR unit_base_cost_snapshot >= 0),
  unit_landed_cost_snapshot numeric(18,6) CHECK (unit_landed_cost_snapshot IS NULL
                                                 OR unit_landed_cost_snapshot >= 0),
  cost_snapshot_status      text NOT NULL DEFAULT 'SNAPSHOTTED'
                              CHECK (cost_snapshot_status IN ('SNAPSHOTTED',
                                                              'PRICE_NEEDED')),
  product_cost_id           uuid REFERENCES product_costs (id),
  line_cogs                 numeric(18,6),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_line_unique UNIQUE (order_id, line_number),
  CONSTRAINT order_items_snapshot_consistent
    CHECK ((cost_snapshot_status = 'SNAPSHOTTED'
              AND unit_landed_cost_snapshot IS NOT NULL AND line_cogs IS NOT NULL)
           OR (cost_snapshot_status = 'PRICE_NEEDED'
              AND unit_landed_cost_snapshot IS NULL AND line_cogs IS NULL))
);

CREATE INDEX order_items_org_order_idx ON order_items (organization_id, order_id);
CREATE INDEX order_items_product_idx ON order_items (product_id);
