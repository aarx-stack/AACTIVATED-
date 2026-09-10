-- AACTIVATED RX affiliate leaderboard — D1 schema.
-- Conventions: all instants are UTC ISO-8601 TEXT; all money is INTEGER cents.
-- America/Los_Angeles is a *display/reporting* concern only (see
-- docs/TIME_AND_BOUNDARIES.md); nothing timezone-dependent is stored.

CREATE TABLE affiliates (
  id                     TEXT PRIMARY KEY,
  tapfiliate_id          TEXT UNIQUE,
  display_name           TEXT NOT NULL,
  display_name_approved  INTEGER NOT NULL DEFAULT 0,
  avatar_url             TEXT,
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','suspended','pending')),
  enrolled_at            TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Server-side mapping from authenticated identity → affiliate/role. The client
-- never sends a role; every request is resolved through this table.
CREATE TABLE auth_users (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,             -- 'cloudflare_access'
  subject       TEXT NOT NULL,             -- Access JWT `sub`
  email         TEXT,
  affiliate_id  TEXT REFERENCES affiliates(id),
  role          TEXT NOT NULL DEFAULT 'affiliate'
                CHECK (role IN ('affiliate','admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, subject)
);

-- Verified parent→child team relationships. A child has at most one parent.
-- Unverified rows exist (imported from source) but are excluded from every
-- rollup until an admin verifies them.
CREATE TABLE team_edges (
  parent_id    TEXT NOT NULL REFERENCES affiliates(id),
  child_id     TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('tapfiliate_mlm','admin')),
  verified     INTEGER NOT NULL DEFAULT 0,
  verified_at  TEXT,
  verified_by  TEXT,
  PRIMARY KEY (child_id)
);

-- Transaction-level ledger. (source, external_id) is the identity of a sale:
-- webhook replays, re-imports and multiple commission records can never
-- create a second row for the same transaction.
CREATE TABLE transactions (
  id                   TEXT PRIMARY KEY,
  source               TEXT NOT NULL CHECK (source IN ('tapfiliate','sellavi','manual')),
  external_id          TEXT NOT NULL,
  order_ref            TEXT,
  affiliate_id         TEXT NOT NULL REFERENCES affiliates(id),
  occurred_at          TEXT NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  gross_cents          INTEGER NOT NULL,
  discount_cents       INTEGER NOT NULL DEFAULT 0,
  tax_cents            INTEGER NOT NULL DEFAULT 0,
  shipping_cents       INTEGER NOT NULL DEFAULT 0,
  refunded_cents       INTEGER NOT NULL DEFAULT 0,
  payment_status       TEXT NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('paid','pending','unpaid','partially_refunded','refunded')),
  payment_verified     INTEGER NOT NULL DEFAULT 0,
  payment_verified_via TEXT CHECK (payment_verified_via IN ('sellavi','admin')),
  is_founders_pack     INTEGER NOT NULL DEFAULT 0,
  -- Monotonic guard for out-of-order source updates (updated_at from source).
  source_updated_at    TEXT,
  corrected_by         TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source, external_id)
);
CREATE INDEX idx_txn_affiliate_time ON transactions (affiliate_id, occurred_at);
CREATE INDEX idx_txn_time ON transactions (occurred_at);

-- Webhook delivery dedupe: one row per delivery; replays no-op on conflict.
CREATE TABLE webhook_events (
  source        TEXT NOT NULL,
  delivery_key  TEXT NOT NULL,            -- event id, else SHA-256 of raw body
  payload_hash  TEXT NOT NULL,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'received'
                CHECK (status IN ('received','processed','failed','skipped_duplicate')),
  error         TEXT,
  PRIMARY KEY (source, delivery_key)
);

-- Singleton challenge configuration. launch_at stays NULL ("Launch date
-- pending") until the owner configures it; `activated` gates any production
-- qualification and requires the policy confirmations in docs/DECISIONS_NEEDED.md.
CREATE TABLE challenge_config (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  launch_at                TEXT,
  window_days              INTEGER NOT NULL DEFAULT 30,
  direct_target_cents      INTEGER NOT NULL DEFAULT 1000000,
  team_target_cents        INTEGER NOT NULL DEFAULT 5000000,
  founders_pack_min_cents  INTEGER NOT NULL DEFAULT 250000,
  seat_cap                 INTEGER NOT NULL DEFAULT 50,
  policy_json              TEXT NOT NULL,
  policy_confirmed         INTEGER NOT NULL DEFAULT 0,
  activated                INTEGER NOT NULL DEFAULT 0,
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by               TEXT
);
INSERT INTO challenge_config (id, policy_json) VALUES (1, json('{
  "netOfDiscounts": true,
  "excludeTax": true,
  "excludeShipping": true,
  "netOfRefunds": true,
  "requireVerifiedPayment": true
}'));

-- The 50 seats. seat_no is dense 1..seat_cap; UNIQUE constraints + the
-- single-statement guarded INSERT in worker/domain/seats.ts make claims
-- atomic — overbooking is structurally impossible.
CREATE TABLE memberships (
  seat_no                INTEGER PRIMARY KEY,
  affiliate_id           TEXT NOT NULL UNIQUE REFERENCES affiliates(id),
  path                   TEXT NOT NULL CHECK (path IN ('direct','team','founders_pack')),
  qualified_at           TEXT NOT NULL,
  verified_at            TEXT NOT NULL,
  membership_expires_at  TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Founders-pack submissions & flagged refunds awaiting a human decision.
CREATE TABLE review_queue (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('founders_pack','path_completion','refund_review')),
  affiliate_id  TEXT NOT NULL REFERENCES affiliates(id),
  txn_id        TEXT REFERENCES transactions(id),
  submitted_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  note          TEXT,
  decided_at    TEXT,
  decided_by    TEXT,
  decision_reason TEXT
);
CREATE INDEX idx_review_pending ON review_queue (status, submitted_at);

-- Periodic leaderboard snapshots — the only source of "rank movement".
CREATE TABLE leaderboard_snapshots (
  period_type   TEXT NOT NULL CHECK (period_type IN ('monthly','weekly')),
  period_key    TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('personal','team')),
  taken_at      TEXT NOT NULL,
  affiliate_id  TEXT NOT NULL,
  rank          INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL,
  PRIMARY KEY (period_type, period_key, scope, affiliate_id)
);

-- Sync/reconciliation observability (drives the admin Integrations panel).
CREATE TABLE sync_runs (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('reconcile','webhook','import','retry','snapshot')),
  source         TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  ok             INTEGER,
  scanned        INTEGER NOT NULL DEFAULT 0,
  updated        INTEGER NOT NULL DEFAULT 0,
  discrepancies  INTEGER NOT NULL DEFAULT 0,
  note           TEXT
);
CREATE INDEX idx_sync_runs_time ON sync_runs (started_at);

-- Append-only audit log; every admin mutation requires a reason.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT
);
CREATE INDEX idx_audit_time ON audit_log (at);
