-- 0002_organizations_users.sql
-- Multi-tenant root: organizations, users, memberships, per-organization settings.
--
-- Core rule: every business-owned operational record in later migrations carries
-- organization_id. AACTIVATED RX is seeded as organization_key = 'AACTIVATED_RX'
-- (tenant #1), never hard-coded into schema or constraints.

CREATE TABLE organizations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_key text NOT NULL,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_key_format CHECK (organization_key ~ '^[A-Z0-9][A-Z0-9_]*$'),
  CONSTRAINT organizations_key_unique UNIQUE (organization_key)
);

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

-- Global identity. Deliberately NO password/credential columns: authentication is
-- out of scope until an auth provider is chosen; external_auth_id links to a
-- future IdP (Auth0/Clerk/Supabase Auth/...) without schema change.
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  full_name        text,
  external_auth_id text,
  status           text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE UNIQUE INDEX users_external_auth_unique ON users (external_auth_id)
  WHERE external_auth_id IS NOT NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

-- Membership + role. RBAC enforcement is future work; the shape is fixed now so
-- role checks can be added without migration churn.
CREATE TABLE organization_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  user_id         uuid NOT NULL REFERENCES users (id),
  role            text NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('owner', 'admin', 'finance', 'operations',
                                    'affiliate_manager', 'marketing', 'viewer')),
  status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_users_member_unique UNIQUE (organization_id, user_id)
);

CREATE INDEX organization_users_user_idx ON organization_users (user_id);

CREATE TRIGGER organization_users_set_updated_at
  BEFORE UPDATE ON organization_users
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();

-- Per-organization configuration. Business numbers that must NOT be baked into
-- code or into every product row live here:
--   logistics_rate         : shipping + labor + storage allocation (0.15 today),
--                            overridable per cost row in product_costs.
--   default_cost_tier      : which supplier tier is active (BULK today).
--   merchant_fee_*         : NULL = NOT_CONFIGURED. Never invent a processor fee.
CREATE TABLE organization_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations (id),
  default_currency        text NOT NULL DEFAULT 'USD' CHECK (default_currency ~ '^[A-Z]{3}$'),
  logistics_rate          numeric(9,6) NOT NULL DEFAULT 0.150000
                            CHECK (logistics_rate >= 0 AND logistics_rate < 1),
  default_cost_tier       text NOT NULL DEFAULT 'BULK'
                            CHECK (default_cost_tier IN ('SMALL', 'BULK')),
  merchant_fee_percentage numeric(9,6) CHECK (merchant_fee_percentage IS NULL
                                              OR (merchant_fee_percentage >= 0 AND merchant_fee_percentage < 1)),
  merchant_fee_fixed      numeric(18,6) CHECK (merchant_fee_fixed IS NULL OR merchant_fee_fixed >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_settings_org_unique UNIQUE (organization_id)
);

CREATE TRIGGER organization_settings_set_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION data_core_set_updated_at();
