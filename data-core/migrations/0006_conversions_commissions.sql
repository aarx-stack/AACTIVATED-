-- 0006_conversions_commissions.sql
-- Tapfiliate conversions and the commission LEDGER.
--
-- Ledger rule: one row per commission event — never a single collapsed total.
-- A conversion under the current program produces up to three rows:
--   DIRECT (selling affiliate's personal rate), MLM_LEVEL_2 (3%), MLM_LEVEL_3 (2%).
-- Corrections are new rows (REVERSAL / MANUAL_ADJUSTMENT), never destructive edits.

CREATE TABLE conversions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations (id),
  external_conversion_id text,
  order_id               uuid REFERENCES orders (id),
  affiliate_id           uuid REFERENCES affiliates (id),
  conversion_amount      numeric(18,6) NOT NULL CHECK (conversion_amount >= 0),
  currency               text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'disapproved')),
  source                 text NOT NULL DEFAULT 'TAPFILIATE'
                           CHECK (source IN ('TAPFILIATE', 'MANUAL', 'OTHER')),
  converted_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: an external conversion id may appear only once per organization.
CREATE UNIQUE INDEX conversions_org_external_id_unique
  ON conversions (organization_id, external_conversion_id)
  WHERE external_conversion_id IS NOT NULL;

CREATE INDEX conversions_org_order_idx ON conversions (organization_id, order_id);
CREATE INDEX conversions_org_affiliate_idx ON conversions (organization_id, affiliate_id);

CREATE TRIGGER conversions_set_updated_at
  BEFORE UPDATE ON conversions
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

CREATE TABLE commissions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations (id),
  conversion_id           uuid REFERENCES conversions (id),
  affiliate_id            uuid NOT NULL REFERENCES affiliates (id),
  commission_type         text NOT NULL
                            CHECK (commission_type IN ('DIRECT', 'MLM_LEVEL_2',
                                                       'MLM_LEVEL_3', 'BONUS',
                                                       'MANUAL_ADJUSTMENT',
                                                       'REVERSAL')),
  commission_rate         numeric(9,6) CHECK (commission_rate IS NULL
                                              OR (commission_rate >= 0 AND commission_rate <= 1)),
  commission_amount       numeric(18,6) NOT NULL,
  currency                text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'disapproved',
                                              'payable', 'paid', 'reversed')),
  external_commission_id  text,
  reversed_commission_id  uuid REFERENCES commissions (id),
  memo                    text,
  approved_at             timestamptz,
  paid_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- Earning types are non-negative; REVERSAL rows are negative (they claw back);
  -- MANUAL_ADJUSTMENT may go either way.
  CONSTRAINT commissions_amount_sign
    CHECK (CASE commission_type
             WHEN 'REVERSAL'          THEN commission_amount <= 0
             WHEN 'MANUAL_ADJUSTMENT' THEN true
             ELSE commission_amount >= 0
           END),
  -- REVERSAL rows must point at the commission they reverse.
  CONSTRAINT commissions_reversal_link
    CHECK ((commission_type = 'REVERSAL') = (reversed_commission_id IS NOT NULL))
);

-- Idempotency: Tapfiliate-supplied commission ids are unique per organization.
CREATE UNIQUE INDEX commissions_org_external_id_unique
  ON commissions (organization_id, external_commission_id)
  WHERE external_commission_id IS NOT NULL;

-- Idempotency: one auto-generated commission per (conversion, affiliate, type) —
-- replaying a webhook cannot double-create DIRECT/MLM rows.
CREATE UNIQUE INDEX commissions_conversion_type_unique
  ON commissions (organization_id, conversion_id, affiliate_id, commission_type)
  WHERE conversion_id IS NOT NULL
    AND commission_type IN ('DIRECT', 'MLM_LEVEL_2', 'MLM_LEVEL_3');

-- A commission can be reversed at most once.
CREATE UNIQUE INDEX commissions_reversal_unique
  ON commissions (reversed_commission_id)
  WHERE reversed_commission_id IS NOT NULL;

CREATE INDEX commissions_org_affiliate_status_idx
  ON commissions (organization_id, affiliate_id, status);
CREATE INDEX commissions_org_conversion_idx
  ON commissions (organization_id, conversion_id);

CREATE TRIGGER commissions_set_updated_at
  BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();
