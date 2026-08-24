/**
 * Tapfiliate ingestion — affiliates, conversions, and the commission ledger.
 *
 * Tapfiliate remains the OPERATIONAL commission system (Phase 1/2 — do not
 * replace, do not change MLM settings or percentages). The Data Core mirrors
 * its output as permanent history:
 *
 *   conversion  -> one conversions row  (unique per org + external id)
 *   commission  -> one commissions LEDGER row per (conversion, affiliate, type):
 *                  DIRECT, MLM_LEVEL_2 (3%), MLM_LEVEL_3 (2%), plus BONUS /
 *                  MANUAL_ADJUSTMENT / REVERSAL entries
 *
 * All writes are idempotent; replaying a webhook converges instead of duplicating.
 */

import { negate, toDecimalString, toMicros } from '../money.js';
import { recordAutomationEvent } from '../services/events.js';
import { writeAudit } from '../services/audit.js';

export const TAPFILIATE_SOURCE = 'TAPFILIATE';

/**
 * Create or refresh an affiliate mirrored from Tapfiliate.
 * Upsert key: (organization_id, external_tapfiliate_id).
 * NOTE: protected_group and team_builder are BUSINESS flags owned by the Data
 * Core — a replay never flips them unless explicitly passed.
 * @param {import('pg').PoolClient} client
 */
export async function upsertAffiliate(client, a) {
  const { rows } = await client.query(
    `INSERT INTO affiliates
       (organization_id, external_tapfiliate_id, external_referral_code, name,
        email, affiliate_group, partner_type, protected_group, team_builder, status)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'STANDARD'),
             COALESCE($8, false), COALESCE($9, false), COALESCE($10, 'ACTIVE'))
     ON CONFLICT (organization_id, external_tapfiliate_id)
       WHERE external_tapfiliate_id IS NOT NULL
       DO UPDATE SET
         external_referral_code = COALESCE(EXCLUDED.external_referral_code, affiliates.external_referral_code),
         name            = COALESCE(EXCLUDED.name, affiliates.name),
         email           = COALESCE(EXCLUDED.email, affiliates.email),
         affiliate_group = COALESCE(EXCLUDED.affiliate_group, affiliates.affiliate_group),
         partner_type    = COALESCE($7, affiliates.partner_type),
         protected_group = COALESCE($8, affiliates.protected_group),
         team_builder    = COALESCE($9, affiliates.team_builder),
         status          = COALESCE($10, affiliates.status)
     RETURNING id, (xmax = 0) AS created`,
    [
      a.organizationId,
      a.externalTapfiliateId,
      a.externalReferralCode ?? null,
      a.name ?? null,
      a.email ?? null,
      a.affiliateGroup ?? null,
      a.partnerType ?? null,
      a.protectedGroup ?? null,
      a.teamBuilder ?? null,
      a.status ?? null,
    ]
  );
  return { affiliateId: rows[0].id, created: rows[0].created === true };
}

/**
 * Open a sponsor edge (closing any currently-open edge of the same type first,
 * so history is preserved rather than overwritten).
 * @param {import('pg').PoolClient} client
 */
export async function setSponsor(client, {
  organizationId,
  affiliateId,
  parentAffiliateId,
  relationshipType = 'MLM_SPONSOR',
  effectiveFrom = new Date(),
  actorId = 'tapfiliate-sync',
}) {
  const { rows: open } = await client.query(
    `SELECT id, parent_affiliate_id FROM affiliate_relationships
     WHERE affiliate_id = $1 AND relationship_type = $2 AND effective_to IS NULL`,
    [affiliateId, relationshipType]
  );
  if (open.length > 0 && open[0].parent_affiliate_id === parentAffiliateId) {
    return { relationshipId: open[0].id, changed: false };
  }
  if (open.length > 0) {
    await client.query(
      `UPDATE affiliate_relationships SET effective_to = $2 WHERE id = $1`,
      [open[0].id, effectiveFrom]
    );
  }
  const { rows } = await client.query(
    `INSERT INTO affiliate_relationships
       (organization_id, affiliate_id, parent_affiliate_id, relationship_type, effective_from)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [organizationId, affiliateId, parentAffiliateId, relationshipType, effectiveFrom]
  );
  await writeAudit(client, {
    organizationId,
    actorType: 'INTEGRATION',
    actorId,
    action: 'affiliate.sponsor_changed',
    entityType: 'affiliate_relationships',
    entityId: rows[0].id,
    before: open[0] ? { parent_affiliate_id: open[0].parent_affiliate_id } : null,
    after: { parent_affiliate_id: parentAffiliateId },
  });
  return { relationshipId: rows[0].id, changed: true };
}

/**
 * Ingest one Tapfiliate conversion. Idempotent on (org, external_conversion_id).
 * Links to the Sellavi order by external order id when provided.
 * @param {import('pg').PoolClient} client
 */
export async function ingestConversion(client, {
  organizationId,
  externalConversionId,
  externalOrderId = null,
  orderSource = 'SELLAVI',
  affiliateId = null,
  conversionAmount,
  currency = 'USD',
  status = 'pending',
  convertedAt = null,
  externalEventId = null,
}) {
  if (!externalConversionId) {
    throw new Error('tapfiliate: externalConversionId is required');
  }
  let orderId = null;
  if (externalOrderId != null) {
    const { rows } = await client.query(
      `SELECT id FROM orders
       WHERE organization_id = $1 AND source = $2 AND external_order_id = $3`,
      [organizationId, orderSource, externalOrderId]
    );
    orderId = rows[0]?.id ?? null;
  }

  const { rows } = await client.query(
    `INSERT INTO conversions
       (organization_id, external_conversion_id, order_id, affiliate_id,
        conversion_amount, currency, status, source, converted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (organization_id, external_conversion_id)
       WHERE external_conversion_id IS NOT NULL
       DO UPDATE SET
         order_id          = COALESCE(conversions.order_id, EXCLUDED.order_id),
         affiliate_id      = COALESCE(EXCLUDED.affiliate_id, conversions.affiliate_id),
         conversion_amount = EXCLUDED.conversion_amount,
         status            = EXCLUDED.status,
         converted_at      = COALESCE(EXCLUDED.converted_at, conversions.converted_at)
     RETURNING id, (xmax = 0) AS created`,
    [
      organizationId,
      externalConversionId,
      orderId,
      affiliateId,
      toDecimalString(toMicros(conversionAmount)),
      currency,
      status,
      TAPFILIATE_SOURCE,
      convertedAt,
    ]
  );
  const conversionId = rows[0].id;
  const created = rows[0].created === true;

  await recordAutomationEvent(client, {
    organizationId,
    eventType: 'CONVERSION_PROCESSED',
    sourceSystem: TAPFILIATE_SOURCE,
    externalEventId: externalEventId ?? `conversion:${externalConversionId}`,
    entityType: 'conversions',
    entityId: conversionId,
    status: 'SUCCESS',
    payload: { external_conversion_id: externalConversionId, created },
  });

  return { conversionId, orderId, created };
}

/**
 * Record one commission ledger row.
 * Idempotency:
 *   - external_commission_id unique per org (Tapfiliate-supplied id), AND
 *   - one (conversion, affiliate, type) row for DIRECT/MLM_LEVEL_2/MLM_LEVEL_3.
 * @param {import('pg').PoolClient} client
 */
export async function recordCommission(client, {
  organizationId,
  conversionId = null,
  affiliateId,
  commissionType,
  commissionRate = null,
  commissionAmount,
  currency = 'USD',
  status = 'pending',
  externalCommissionId = null,
  memo = null,
}) {
  const amount = toDecimalString(toMicros(commissionAmount));
  const params = [
    organizationId,
    conversionId,
    affiliateId,
    commissionType,
    commissionRate,
    amount,
    currency,
    status,
    externalCommissionId,
    memo,
  ];
  const insert = `
    INSERT INTO commissions
      (organization_id, conversion_id, affiliate_id, commission_type,
       commission_rate, commission_amount, currency, status,
       external_commission_id, memo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

  // Choose the conflict target that applies; both indexes protect the ledger.
  const conflict =
    externalCommissionId != null
      ? `ON CONFLICT (organization_id, external_commission_id)
           WHERE external_commission_id IS NOT NULL`
      : `ON CONFLICT (organization_id, conversion_id, affiliate_id, commission_type)
           WHERE conversion_id IS NOT NULL
             AND commission_type IN ('DIRECT','MLM_LEVEL_2','MLM_LEVEL_3')`;

  const { rows } = await client.query(
    `${insert}
     ${conflict}
     DO UPDATE SET
       commission_rate   = COALESCE(EXCLUDED.commission_rate, commissions.commission_rate),
       commission_amount = EXCLUDED.commission_amount,
       status            = CASE WHEN commissions.status IN ('paid', 'reversed')
                                THEN commissions.status  -- terminal states never regress
                                ELSE EXCLUDED.status END
     RETURNING id, (xmax = 0) AS created`,
    params
  );
  return { commissionId: rows[0].id, created: rows[0].created === true };
}

/**
 * Reverse a commission: appends a negative REVERSAL ledger row and marks the
 * original as 'reversed'. The partial unique index on reversed_commission_id
 * makes double-reversal impossible.
 * @param {import('pg').PoolClient} client
 */
export async function reverseCommission(client, {
  organizationId,
  commissionId,
  reason,
  actorType = 'SYSTEM',
  actorId = null,
}) {
  const { rows: originals } = await client.query(
    `SELECT * FROM commissions WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [commissionId, organizationId]
  );
  if (originals.length === 0) {
    throw new Error(`tapfiliate: commission ${commissionId} not found in organization`);
  }
  const original = originals[0];
  if (original.status === 'reversed') {
    throw new Error(`tapfiliate: commission ${commissionId} is already reversed`);
  }

  const { rows: reversalRows } = await client.query(
    `INSERT INTO commissions
       (organization_id, conversion_id, affiliate_id, commission_type,
        commission_rate, commission_amount, currency, status,
        reversed_commission_id, memo)
     VALUES ($1, $2, $3, 'REVERSAL', $4, $5, $6, 'approved', $7, $8)
     RETURNING id`,
    [
      organizationId,
      original.conversion_id,
      original.affiliate_id,
      original.commission_rate,
      toDecimalString(negate(original.commission_amount)),
      original.currency,
      commissionId,
      reason ?? null,
    ]
  );

  await client.query(`UPDATE commissions SET status = 'reversed' WHERE id = $1`, [
    commissionId,
  ]);

  await writeAudit(client, {
    organizationId,
    actorType,
    actorId,
    action: 'commission.reversed',
    entityType: 'commissions',
    entityId: commissionId,
    before: { status: original.status, commission_amount: original.commission_amount },
    after: { status: 'reversed', reversal_id: reversalRows[0].id },
    reason,
  });

  return { reversalId: reversalRows[0].id, originalId: commissionId };
}
