-- 0005_affiliates.sql
-- Affiliates (Tapfiliate-backed) and effective-dated sponsor relationships.
--
-- Tapfiliate remains the operational MLM system (Phase 2 — do not replace).
-- The Data Core mirrors affiliates and their sponsor tree so commissions,
-- payouts, and history survive independently of the SaaS provider.
--
-- protected_group = true marks affiliates whose group/tier must never be changed
-- by automation (Phase 2 rule); services must skip them and record a
-- PROTECTED_GROUP_SKIPPED automation event instead.

CREATE TABLE affiliates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations (id),
  external_tapfiliate_id text,
  external_referral_code text,
  name                   text,
  email                  text,
  affiliate_group        text,
  partner_type           text NOT NULL DEFAULT 'STANDARD'
                           CHECK (partner_type IN ('STANDARD', 'TEAM_BUILDER',
                                                   'INFLUENCER', 'INTERNAL', 'OTHER')),
  protected_group        boolean NOT NULL DEFAULT false,
  team_builder           boolean NOT NULL DEFAULT false,
  status                 text NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('PENDING', 'ACTIVE', 'PAUSED',
                                             'TERMINATED')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliates_org_tapfiliate_id_unique
  ON affiliates (organization_id, external_tapfiliate_id)
  WHERE external_tapfiliate_id IS NOT NULL;

CREATE UNIQUE INDEX affiliates_org_referral_code_unique
  ON affiliates (organization_id, external_referral_code)
  WHERE external_referral_code IS NOT NULL;

CREATE INDEX affiliates_org_status_idx ON affiliates (organization_id, status);

CREATE TRIGGER affiliates_set_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

-- Sponsor edges are effective-dated, never overwritten: when a sponsor changes,
-- the old edge is closed (effective_to) and a new edge opened, so historical
-- MLM commissions can always be traced to the tree as it stood at the time.
CREATE TABLE affiliate_relationships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id),
  affiliate_id        uuid NOT NULL REFERENCES affiliates (id),
  parent_affiliate_id uuid NOT NULL REFERENCES affiliates (id),
  relationship_type   text NOT NULL DEFAULT 'MLM_SPONSOR'
                        CHECK (relationship_type IN ('MLM_SPONSOR', 'RECRUITER',
                                                     'OTHER')),
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_to        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_relationships_not_self
    CHECK (affiliate_id <> parent_affiliate_id),
  CONSTRAINT affiliate_relationships_window_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- At most one active parent per relationship type per affiliate at any moment.
  CONSTRAINT affiliate_relationships_no_overlap
    EXCLUDE USING gist (
      affiliate_id WITH =,
      relationship_type WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
    )
);

CREATE INDEX affiliate_relationships_parent_idx
  ON affiliate_relationships (organization_id, parent_affiliate_id);
