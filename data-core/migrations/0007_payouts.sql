-- 0007_payouts.sql
-- Payouts and payout items — provider-neutral, automation-honest.
--
-- payout_method is what the money moves over (ACH, BANK_TRANSFER, PAYPAL, ZELLE,
-- OTHER). automation_capability records whether a supported provider/API can
-- execute it: Zelle is a legal method but stays MANUAL_ONLY because no supported
-- payout API exists — nothing in the schema pretends it is automatable.
-- No bank credentials are stored anywhere; only external provider references.

CREATE TABLE payouts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id),
  affiliate_id          uuid NOT NULL REFERENCES affiliates (id),
  payout_method         text NOT NULL
                          CHECK (payout_method IN ('ACH', 'BANK_TRANSFER', 'PAYPAL',
                                                   'ZELLE', 'OTHER')),
  automation_capability text NOT NULL DEFAULT 'MANUAL_ONLY'
                          CHECK (automation_capability IN ('MANUAL_ONLY',
                                                           'PROVIDER_AUTOMATED')),
  provider              text,
  external_payout_id    text,
  total_amount          numeric(18,6) NOT NULL CHECK (total_amount >= 0),
  currency              text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'PENDING', 'PROCESSING',
                                            'SETTLED', 'FAILED', 'CANCELLED')),
  scheduled_for         date,
  settled_at            timestamptz,
  memo                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Automated payouts must name the provider executing them.
  CONSTRAINT payouts_automated_has_provider
    CHECK (automation_capability = 'MANUAL_ONLY' OR provider IS NOT NULL)
);

CREATE UNIQUE INDEX payouts_org_external_id_unique
  ON payouts (organization_id, external_payout_id)
  WHERE external_payout_id IS NOT NULL;

CREATE INDEX payouts_org_affiliate_idx ON payouts (organization_id, affiliate_id);
CREATE INDEX payouts_org_status_idx ON payouts (organization_id, status);

CREATE TRIGGER payouts_set_updated_at
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

-- Double-pay guard: a commission may sit in at most ONE payout, ever
-- (payout_items_commission_unique). Releasing a commission from a FAILED or
-- CANCELLED payout is an explicit, audited delete of its payout_items row —
-- see src/services/payouts.js and docs/RUNBOOK.md.
CREATE TABLE payout_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  payout_id       uuid NOT NULL REFERENCES payouts (id) ON DELETE CASCADE,
  commission_id   uuid NOT NULL REFERENCES commissions (id),
  amount          numeric(18,6) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_items_commission_unique UNIQUE (commission_id)
);

CREATE INDEX payout_items_payout_idx ON payout_items (payout_id);
