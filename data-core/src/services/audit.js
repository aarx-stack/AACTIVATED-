/**
 * Audit log writer — who changed what, with before/after images.
 *
 * Append-only by convention: nothing in the codebase updates or deletes
 * audit_log rows, and no service exposes a way to. Sensitive keys are redacted
 * from the JSON images with the same rules as automation event payloads.
 */

import { redactPayload } from './events.js';

/**
 * Write one audit entry.
 * @param {import('pg').PoolClient} client
 * @param {object} entry
 * @param {string} entry.organizationId
 * @param {'USER'|'SYSTEM'|'INTEGRATION'} entry.actorType
 * @param {string} [entry.actorId]     user id / integration name
 * @param {string} entry.action        e.g. 'affiliate.group_changed'
 * @param {string} entry.entityType    e.g. 'affiliates'
 * @param {string} [entry.entityId]
 * @param {object} [entry.before]
 * @param {object} [entry.after]
 * @param {string} [entry.reason]
 * @returns {Promise<{id: string}>}
 */
export async function writeAudit(client, entry) {
  const { rows } = await client.query(
    `INSERT INTO audit_log
       (organization_id, actor_type, actor_id, action, entity_type, entity_id,
        before_json, after_json, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
     RETURNING id`,
    [
      entry.organizationId,
      entry.actorType,
      entry.actorId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(redactPayload(entry.before)),
      entry.after === undefined ? null : JSON.stringify(redactPayload(entry.after)),
      entry.reason ?? null,
    ]
  );
  return { id: rows[0].id };
}
