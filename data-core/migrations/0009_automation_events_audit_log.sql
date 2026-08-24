-- 0009_automation_events_audit_log.sql
-- Automation event history and the enterprise audit log.
--
-- automation_events: what the machines did (webhooks, imports, evaluations).
-- audit_log:         who changed what, with before/after images — diligence-grade.
-- payload_json must NEVER contain secrets; src/services/events.js redacts
-- known-sensitive keys before insert as a second line of defense.

CREATE TABLE automation_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id),
  event_type        text NOT NULL
                      CHECK (event_type IN ('WEBHOOK_RECEIVED', 'CONVERSION_PROCESSED',
                                            'AFFILIATE_TIER_EVALUATED',
                                            'AFFILIATE_GROUP_CHANGED',
                                            'PROTECTED_GROUP_SKIPPED', 'MLM_EVALUATED',
                                            'ORDER_IMPORTED', 'FINANCIAL_CALCULATED',
                                            'PAYOUT_CREATED', 'PAYOUT_SETTLED',
                                            'ERROR', 'OTHER')),
  source_system     text NOT NULL DEFAULT 'DATA_CORE',
  external_event_id text,
  entity_type       text,
  entity_id         text,
  status            text NOT NULL DEFAULT 'SUCCESS'
                      CHECK (status IN ('SUCCESS', 'SKIPPED', 'FAILED')),
  payload_json      jsonb,
  error_message     text,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: an externally-identified event lands once per org+source.
CREATE UNIQUE INDEX automation_events_external_unique
  ON automation_events (organization_id, source_system, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE INDEX automation_events_org_type_idx
  ON automation_events (organization_id, event_type, occurred_at DESC);
CREATE INDEX automation_events_entity_idx
  ON automation_events (organization_id, entity_type, entity_id);

CREATE TABLE audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  actor_type      text NOT NULL
                    CHECK (actor_type IN ('USER', 'SYSTEM', 'INTEGRATION')),
  actor_id        text,
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text,
  before_json     jsonb,
  after_json      jsonb,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_org_entity_idx
  ON audit_log (organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_org_created_idx
  ON audit_log (organization_id, created_at DESC);
