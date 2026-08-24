/**
 * Automation event recording — the machine activity history.
 *
 * Idempotent: events carrying an external_event_id land at most once per
 * (organization, source_system) thanks to automation_events_external_unique;
 * replays are no-ops that report created=false.
 *
 * Secrets never reach payload_json: redactPayload strips known-sensitive keys
 * recursively before insert. This is defense-in-depth — callers should already
 * be passing minimal payloads (docs/SECURITY.md).
 */

const SENSITIVE_KEY_RE =
  /secret|token|password|passwd|api[-_]?key|authorization|auth[-_]?header|bearer|credential|private[-_]?key|card[-_]?number|pan\b|cvv|cvc|iban|account[-_]?number|routing[-_]?number|ssn/i;

export const EVENT_TYPES = Object.freeze([
  'WEBHOOK_RECEIVED',
  'CONVERSION_PROCESSED',
  'AFFILIATE_TIER_EVALUATED',
  'AFFILIATE_GROUP_CHANGED',
  'PROTECTED_GROUP_SKIPPED',
  'MLM_EVALUATED',
  'ORDER_IMPORTED',
  'FINANCIAL_CALCULATED',
  'PAYOUT_CREATED',
  'PAYOUT_SETTLED',
  'ERROR',
  'OTHER',
]);

/**
 * Recursively strip sensitive keys from a JSON-safe payload.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactPayload(value) {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : redactPayload(v);
    }
    return out;
  }
  return value;
}

/**
 * Record an automation event.
 * @param {import('pg').PoolClient} client
 * @param {object} event
 * @param {string} event.organizationId
 * @param {string} event.eventType         one of EVENT_TYPES
 * @param {string} [event.sourceSystem]    e.g. 'SELLAVI' | 'TAPFILIATE' | 'DATA_CORE'
 * @param {string} [event.externalEventId] enables idempotent replay
 * @param {string} [event.entityType]
 * @param {string} [event.entityId]
 * @param {'SUCCESS'|'SKIPPED'|'FAILED'} [event.status]
 * @param {object} [event.payload]
 * @param {string} [event.errorMessage]
 * @param {Date|string} [event.occurredAt]
 * @returns {Promise<{id: string|null, created: boolean}>}
 */
export async function recordAutomationEvent(client, event) {
  if (!EVENT_TYPES.includes(event.eventType)) {
    throw new RangeError(`events: unknown event_type "${event.eventType}"`);
  }
  const payload =
    event.payload === undefined ? null : JSON.stringify(redactPayload(event.payload));
  const { rows } = await client.query(
    `INSERT INTO automation_events
       (organization_id, event_type, source_system, external_event_id,
        entity_type, entity_id, status, payload_json, error_message, occurred_at)
     VALUES ($1, $2, COALESCE($3, 'DATA_CORE'), $4, $5, $6,
             COALESCE($7, 'SUCCESS'), $8::jsonb, $9, COALESCE($10, now()))
     ON CONFLICT (organization_id, source_system, external_event_id)
       WHERE external_event_id IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      event.organizationId,
      event.eventType,
      event.sourceSystem ?? null,
      event.externalEventId ?? null,
      event.entityType ?? null,
      event.entityId ?? null,
      event.status ?? null,
      payload,
      event.errorMessage ?? null,
      event.occurredAt ?? null,
    ]
  );
  return { id: rows[0]?.id ?? null, created: rows.length > 0 };
}
