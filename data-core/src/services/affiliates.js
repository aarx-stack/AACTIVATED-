/**
 * Affiliate group/tier changes with the Phase 2 protected-group guard.
 *
 * Rule: an affiliate with protected_group = true is NEVER moved by automation.
 * The attempt is recorded as a PROTECTED_GROUP_SKIPPED automation event and the
 * affiliate is left untouched. Changes to unprotected affiliates are applied,
 * audited (before/after), and recorded as AFFILIATE_GROUP_CHANGED.
 */

import { recordAutomationEvent } from './events.js';
import { writeAudit } from './audit.js';

/**
 * Apply an affiliate group change, honoring the protected-group rule.
 * @param {import('pg').PoolClient} client
 * @param {object} args
 * @param {string} args.organizationId
 * @param {string} args.affiliateId
 * @param {string} args.newGroup
 * @param {'USER'|'SYSTEM'|'INTEGRATION'} [args.actorType]
 * @param {string} [args.actorId]
 * @param {string} [args.reason]
 * @returns {Promise<{changed: boolean, skippedProtected: boolean, previousGroup: string|null}>}
 */
export async function applyGroupChange(client, {
  organizationId,
  affiliateId,
  newGroup,
  actorType = 'SYSTEM',
  actorId = 'tier-automation',
  reason = null,
}) {
  const { rows } = await client.query(
    `SELECT id, affiliate_group, protected_group FROM affiliates
     WHERE id = $1 AND organization_id = $2
     FOR UPDATE`,
    [affiliateId, organizationId]
  );
  if (rows.length === 0) {
    throw new Error(`affiliates: ${affiliateId} not found in organization`);
  }
  const affiliate = rows[0];

  if (affiliate.protected_group) {
    await recordAutomationEvent(client, {
      organizationId,
      eventType: 'PROTECTED_GROUP_SKIPPED',
      sourceSystem: 'DATA_CORE',
      entityType: 'affiliates',
      entityId: affiliateId,
      status: 'SKIPPED',
      payload: {
        attempted_group: newGroup,
        current_group: affiliate.affiliate_group,
        reason: 'protected_group affiliates are never moved by automation',
      },
    });
    return {
      changed: false,
      skippedProtected: true,
      previousGroup: affiliate.affiliate_group,
    };
  }

  if (affiliate.affiliate_group === newGroup) {
    return { changed: false, skippedProtected: false, previousGroup: newGroup };
  }

  await client.query(
    `UPDATE affiliates SET affiliate_group = $2 WHERE id = $1`,
    [affiliateId, newGroup]
  );

  await writeAudit(client, {
    organizationId,
    actorType,
    actorId,
    action: 'affiliate.group_changed',
    entityType: 'affiliates',
    entityId: affiliateId,
    before: { affiliate_group: affiliate.affiliate_group },
    after: { affiliate_group: newGroup },
    reason,
  });

  await recordAutomationEvent(client, {
    organizationId,
    eventType: 'AFFILIATE_GROUP_CHANGED',
    sourceSystem: 'DATA_CORE',
    entityType: 'affiliates',
    entityId: affiliateId,
    status: 'SUCCESS',
    payload: { from: affiliate.affiliate_group, to: newGroup },
  });

  return {
    changed: true,
    skippedProtected: false,
    previousGroup: affiliate.affiliate_group,
  };
}
