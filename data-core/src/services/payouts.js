/**
 * Payouts — provider-neutral, automation-honest, double-pay-proof.
 *
 * Rules encoded here (Phase 3 spec):
 *   - payout methods: ACH, BANK_TRANSFER, PAYPAL, ZELLE, OTHER.
 *   - Nothing is PROVIDER_AUTOMATED unless a supported provider is allowlisted.
 *     The allowlist is EMPTY today — no payout provider (Trolley, etc.) has been
 *     approved, and Zelle has no supported payout API, so every payout is
 *     MANUAL_ONLY. This file is where a future approved provider gets added.
 *   - A commission can be attached to at most one payout ever
 *     (payout_items_commission_unique); releasing commissions from a FAILED or
 *     CANCELLED payout is an explicit, audited operation.
 *   - No banking credentials anywhere — only external provider references.
 */

import { sum, toDecimalString } from '../money.js';
import { recordAutomationEvent } from './events.js';
import { writeAudit } from './audit.js';

export const PAYOUT_METHODS = Object.freeze([
  'ACH',
  'BANK_TRANSFER',
  'PAYPAL',
  'ZELLE',
  'OTHER',
]);

// Providers approved for automated execution. Deliberately empty in Phase 3:
// adding one requires business approval (docs/RUNBOOK.md).
export const AUTOMATABLE_PROVIDERS = Object.freeze([]);

/**
 * Create a payout from a set of payable commissions for one affiliate.
 * @param {import('pg').PoolClient} client
 * @param {object} args
 * @param {string} args.organizationId
 * @param {string} args.affiliateId
 * @param {string} args.payoutMethod  one of PAYOUT_METHODS
 * @param {string[]} args.commissionIds
 * @param {string} [args.provider]
 * @param {string} [args.externalPayoutId]
 * @param {string} [args.currency]
 * @param {string} [args.memo]
 * @param {string} [args.actorId]
 * @returns {Promise<{payoutId: string, totalAmount: string, automationCapability: string}>}
 */
export async function createPayout(client, {
  organizationId,
  affiliateId,
  payoutMethod,
  commissionIds,
  provider = null,
  externalPayoutId = null,
  currency = 'USD',
  memo = null,
  actorId = null,
}) {
  if (!PAYOUT_METHODS.includes(payoutMethod)) {
    throw new RangeError(`payouts: unknown payout method "${payoutMethod}"`);
  }
  if (!commissionIds || commissionIds.length === 0) {
    throw new Error('payouts: at least one commission is required');
  }

  // Automation honesty: only an allowlisted provider makes a payout automatable.
  const automationCapability =
    provider != null && AUTOMATABLE_PROVIDERS.includes(provider)
      ? 'PROVIDER_AUTOMATED'
      : 'MANUAL_ONLY';

  // Lock and validate the commissions being paid.
  const { rows: commissions } = await client.query(
    `SELECT id, commission_amount, currency, status, affiliate_id
     FROM commissions
     WHERE organization_id = $1 AND id = ANY($2::uuid[])
     FOR UPDATE`,
    [organizationId, commissionIds]
  );
  if (commissions.length !== commissionIds.length) {
    throw new Error('payouts: one or more commissions not found in organization');
  }
  for (const c of commissions) {
    if (c.affiliate_id !== affiliateId) {
      throw new Error(`payouts: commission ${c.id} belongs to a different affiliate`);
    }
    if (!['approved', 'payable'].includes(c.status)) {
      throw new Error(
        `payouts: commission ${c.id} is '${c.status}' — only approved/payable commissions can be paid`
      );
    }
    if (c.currency !== currency) {
      throw new Error(`payouts: commission ${c.id} currency mismatch`);
    }
  }

  const totalAmount = toDecimalString(sum(commissions.map((c) => c.commission_amount)));

  const { rows: payoutRows } = await client.query(
    `INSERT INTO payouts
       (organization_id, affiliate_id, payout_method, automation_capability,
        provider, external_payout_id, total_amount, currency, status, memo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9)
     RETURNING id`,
    [
      organizationId,
      affiliateId,
      payoutMethod,
      automationCapability,
      provider,
      externalPayoutId,
      totalAmount,
      currency,
      memo,
    ]
  );
  const payoutId = payoutRows[0].id;

  // payout_items_commission_unique makes double-inclusion impossible at the
  // database level; this insert is what a duplicate attempt bounces off.
  for (const c of commissions) {
    await client.query(
      `INSERT INTO payout_items (organization_id, payout_id, commission_id, amount)
       VALUES ($1, $2, $3, $4)`,
      [organizationId, payoutId, c.id, c.commission_amount]
    );
  }

  await client.query(
    `UPDATE commissions SET status = 'payable'
     WHERE id = ANY($1::uuid[]) AND status = 'approved'`,
    [commissionIds]
  );

  await recordAutomationEvent(client, {
    organizationId,
    eventType: 'PAYOUT_CREATED',
    sourceSystem: 'DATA_CORE',
    entityType: 'payouts',
    entityId: payoutId,
    status: 'SUCCESS',
    payload: {
      payout_method: payoutMethod,
      automation_capability: automationCapability,
      commission_count: commissions.length,
      total_amount: totalAmount,
    },
  });
  await writeAudit(client, {
    organizationId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    actorId,
    action: 'payout.created',
    entityType: 'payouts',
    entityId: payoutId,
    after: { payout_method: payoutMethod, total_amount: totalAmount },
  });

  return { payoutId, totalAmount, automationCapability };
}

/**
 * Mark a payout settled and its commissions paid.
 * @param {import('pg').PoolClient} client
 */
export async function settlePayout(client, { organizationId, payoutId, settledAt = new Date(), actorId = null }) {
  const { rows } = await client.query(
    `UPDATE payouts SET status = 'SETTLED', settled_at = $3
     WHERE id = $1 AND organization_id = $2 AND status IN ('PENDING', 'PROCESSING')
     RETURNING id`,
    [payoutId, organizationId, settledAt]
  );
  if (rows.length === 0) {
    throw new Error(`payouts: payout ${payoutId} not found or not settleable`);
  }
  await client.query(
    `UPDATE commissions SET status = 'paid', paid_at = $2
     WHERE id IN (SELECT commission_id FROM payout_items WHERE payout_id = $1)`,
    [payoutId, settledAt]
  );
  await recordAutomationEvent(client, {
    organizationId,
    eventType: 'PAYOUT_SETTLED',
    sourceSystem: 'DATA_CORE',
    entityType: 'payouts',
    entityId: payoutId,
    status: 'SUCCESS',
  });
  await writeAudit(client, {
    organizationId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    actorId,
    action: 'payout.settled',
    entityType: 'payouts',
    entityId: payoutId,
  });
  return { payoutId, settled: true };
}

/**
 * Cancel/fail a payout and release its commissions back to 'approved' so they
 * can be paid on a future payout. The release (deleting payout_items) is what
 * frees the unique commission slot — audited explicitly.
 * @param {import('pg').PoolClient} client
 */
export async function releasePayout(client, { organizationId, payoutId, toStatus = 'CANCELLED', reason = null, actorId = null }) {
  if (!['CANCELLED', 'FAILED'].includes(toStatus)) {
    throw new RangeError(`payouts: release target must be CANCELLED or FAILED`);
  }
  const { rows } = await client.query(
    `UPDATE payouts SET status = $3
     WHERE id = $1 AND organization_id = $2 AND status IN ('DRAFT', 'PENDING', 'PROCESSING')
     RETURNING id`,
    [payoutId, organizationId, toStatus]
  );
  if (rows.length === 0) {
    throw new Error(`payouts: payout ${payoutId} not found or already terminal`);
  }
  await client.query(
    `UPDATE commissions SET status = 'approved'
     WHERE status = 'payable'
       AND id IN (SELECT commission_id FROM payout_items WHERE payout_id = $1)`,
    [payoutId]
  );
  await client.query(`DELETE FROM payout_items WHERE payout_id = $1`, [payoutId]);
  await writeAudit(client, {
    organizationId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    actorId,
    action: `payout.${toStatus.toLowerCase()}`,
    entityType: 'payouts',
    entityId: payoutId,
    reason,
  });
  return { payoutId, released: true };
}
