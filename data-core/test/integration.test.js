/**
 * Integration tests against a real PostgreSQL (ephemeral local cluster, or
 * TEST_DATABASE_URL). Covers the Phase 3 required scenarios: organization
 * isolation, idempotency (orders/conversions/commissions/events), effective-
 * dated cost snapshots, missing supplier prices, profit calculation, refunds,
 * reversals, MLM ledger rows, protected affiliates, audit + automation events,
 * and payout double-pay protection.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { withTransaction, getOrganizationId } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { ingestSellaviOrder } from '../src/ingest/sellavi.js';
import {
  ingestConversion,
  recordCommission,
  reverseCommission,
  upsertAffiliate,
  setSponsor,
} from '../src/ingest/tapfiliate.js';
import { applyGroupChange } from '../src/services/affiliates.js';
import { calculateOrderFinancials } from '../src/services/financials.js';
import { createPayout, settlePayout } from '../src/services/payouts.js';
import { startTestDatabase } from './pg-harness.js';

let db = null;
let pool = null;
let orgId = null; // AACTIVATED_RX
let org2Id = null; // second tenant for isolation tests

const T1 = '2026-02-01T00:00:00Z'; // inside seeded cost window
const T2 = '2026-03-01T00:00:00Z'; // reprice boundary
const T3 = '2026-04-01T00:00:00Z'; // after reprice

before(async () => {
  db = await startTestDatabase();
  if (!db) return;
  pool = db.pool;
  await migrate(pool);
  // Idempotency of the runner itself:
  const second = await migrate(pool);
  assert.equal(second.applied.length, 0, 'second migrate run must apply nothing');
  await seed(pool);
  await seed(pool); // seeds are idempotent
  orgId = await getOrganizationId(pool, 'AACTIVATED_RX');

  // Second tenant, created through the same public schema — no special-casing.
  await pool.query(
    `INSERT INTO organizations (organization_key, name) VALUES ('ORG_TWO', 'Org Two')
     ON CONFLICT (organization_key) DO NOTHING`
  );
  org2Id = await getOrganizationId(pool, 'ORG_TWO');
  await pool.query(
    `INSERT INTO organization_settings (organization_id) VALUES ($1)
     ON CONFLICT (organization_id) DO NOTHING`,
    [org2Id]
  );
});

after(async () => {
  if (db) await db.stop();
});

const requireDb = (t) => {
  if (!db) {
    t.skip('no PostgreSQL available (set TEST_DATABASE_URL or install postgres binaries)');
    return false;
  }
  return true;
};

const ORDER_4852 = {
  externalOrderId: 'SELLAVI-4852',
  currency: 'USD',
  subtotal: '300.00',
  discountTotal: '0',
  refundTotal: '0',
  customerReference: 'cust-ref-001',
  orderedAt: T1,
  items: [{ sku: 'RETATRUTIDE-10MG', quantity: 2, unitPrice: '150.00' }],
};

test('seeded tenant, settings, supplier, and costs are correct', async (t) => {
  if (!requireDb(t)) return;
  const { rows: settings } = await pool.query(
    `SELECT * FROM organization_settings WHERE organization_id = $1`, [orgId]);
  assert.equal(settings[0].logistics_rate, '0.150000');
  assert.equal(settings[0].default_cost_tier, 'BULK');
  assert.equal(settings[0].merchant_fee_percentage, null);
  assert.equal(settings[0].merchant_fee_fixed, null);

  const { rows: costs } = await pool.query(
    `SELECT p.sku, pc.cost_status, pc.small_kit_cost, pc.bulk_kit_cost, pc.vials_per_kit
     FROM product_costs pc JOIN products p ON p.id = pc.product_id
     WHERE pc.organization_id = $1 ORDER BY p.sku`, [orgId]);
  const reta = costs.find((c) => c.sku === 'RETATRUTIDE-10MG');
  const tesa = costs.find((c) => c.sku === 'TESA-IPA-5MG-5MG');
  assert.equal(reta.cost_status, 'PRICED');
  assert.equal(reta.small_kit_cost, '153.750000');
  assert.equal(reta.bulk_kit_cost, '129.150000');
  assert.equal(reta.vials_per_kit, 10);
  assert.equal(tesa.cost_status, 'PRICE_NEEDED');
  assert.equal(tesa.small_kit_cost, null);
  assert.equal(tesa.bulk_kit_cost, null);
});

test('organization isolation: same SKU and same external ids coexist across tenants', async (t) => {
  if (!requireDb(t)) return;
  // Same SKU in org 2 is fine (org-scoped uniqueness)…
  await pool.query(
    `INSERT INTO products (organization_id, sku, product_name, strength)
     VALUES ($1, 'RETATRUTIDE-10MG', 'Retatrutide', '10mg')`, [org2Id]);
  // …but a duplicate SKU within one org is rejected.
  await assert.rejects(
    pool.query(
      `INSERT INTO products (organization_id, sku, product_name)
       VALUES ($1, 'RETATRUTIDE-10MG', 'Duplicate')`, [orgId]),
    /duplicate key/
  );

  // Same external order id lands separately per tenant.
  await withTransaction(pool, (c) =>
    ingestSellaviOrder(c, { organizationId: orgId, payload: ORDER_4852 }));
  await withTransaction(pool, (c) =>
    ingestSellaviOrder(c, {
      organizationId: org2Id,
      payload: { ...ORDER_4852, items: [] },
    }));
  const { rows } = await pool.query(
    `SELECT organization_id, count(*) FROM orders
     WHERE external_order_id = 'SELLAVI-4852' GROUP BY organization_id`);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.count, '1');

  // Org-scoped read sees only its own order.
  const { rows: mine } = await pool.query(
    `SELECT count(*) FROM orders WHERE organization_id = $1 AND external_order_id = 'SELLAVI-4852'`,
    [orgId]);
  assert.equal(mine[0].count, '1');
});

test('duplicate Sellavi order: replay converges to one row and one event', async (t) => {
  if (!requireDb(t)) return;
  const replay = await withTransaction(pool, (c) =>
    ingestSellaviOrder(c, { organizationId: orgId, payload: ORDER_4852 }));
  assert.equal(replay.created, false, 'replay must update, not insert');
  const { rows } = await pool.query(
    `SELECT count(*) FROM orders
     WHERE organization_id = $1 AND source = 'SELLAVI' AND external_order_id = 'SELLAVI-4852'`,
    [orgId]);
  assert.equal(rows[0].count, '1');

  // Automation event deduped by (org, source_system, external_event_id).
  const { rows: events } = await pool.query(
    `SELECT count(*) FROM automation_events
     WHERE organization_id = $1 AND source_system = 'SELLAVI'
       AND external_event_id = 'order-import:SELLAVI-4852'`, [orgId]);
  assert.equal(events[0].count, '1');
});

test('cost snapshot: landed cost frozen on the order item with exact spec values', async (t) => {
  if (!requireDb(t)) return;
  const { rows } = await pool.query(
    `SELECT oi.* FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.organization_id = $1 AND o.external_order_id = 'SELLAVI-4852'`, [orgId]);
  assert.equal(rows.length, 1);
  const item = rows[0];
  assert.equal(item.cost_snapshot_status, 'SNAPSHOTTED');
  assert.equal(item.unit_base_cost_snapshot, '12.915000');
  assert.equal(item.unit_landed_cost_snapshot, '14.852250'); // 12.915 × 1.15
  assert.equal(item.line_cogs, '29.704500'); // × 2 vials
  assert.ok(item.product_cost_id, 'snapshot records which cost row was used');
});

test('historical cost snapshot survives a supplier reprice', async (t) => {
  if (!requireDb(t)) return;
  // Close the current window at T2 and open a more expensive one.
  const { rows: costRows } = await pool.query(
    `SELECT pc.id FROM product_costs pc
     JOIN products p ON p.id = pc.product_id
     WHERE pc.organization_id = $1 AND p.sku = 'RETATRUTIDE-10MG'
       AND pc.effective_to IS NULL`, [orgId]);
  await pool.query(`UPDATE product_costs SET effective_to = $2 WHERE id = $1`,
    [costRows[0].id, T2]);
  await pool.query(
    `INSERT INTO product_costs
       (organization_id, product_id, supplier_id, cost_status, small_kit_cost,
        bulk_kit_cost, vials_per_kit, active_cost_tier, effective_from, source_reference)
     SELECT pc.organization_id, pc.product_id, pc.supplier_id, 'PRICED',
            pc.small_kit_cost, 140.000000, pc.vials_per_kit, pc.active_cost_tier,
            $2, 'test reprice'
     FROM product_costs pc WHERE pc.id = $1`, [costRows[0].id, T2]);

  // Overlapping window is impossible (exclusion constraint).
  await assert.rejects(
    pool.query(
      `INSERT INTO product_costs
         (organization_id, product_id, supplier_id, cost_status, bulk_kit_cost,
          vials_per_kit, active_cost_tier, effective_from)
       SELECT organization_id, product_id, supplier_id, 'PRICED', 150, 10, 'BULK', $2
       FROM product_costs WHERE id = $1`, [costRows[0].id, T1]),
    /conflicting key value|exclusion constraint/
  );

  // A NEW order after the reprice snapshots the NEW landed cost: 140/10 × 1.15 = 16.1
  await withTransaction(pool, (c) =>
    ingestSellaviOrder(c, {
      organizationId: orgId,
      payload: {
        ...ORDER_4852,
        externalOrderId: 'SELLAVI-4900',
        orderedAt: T3,
        items: [{ sku: 'RETATRUTIDE-10MG', quantity: 1, unitPrice: '150.00' }],
      },
    }));
  const { rows: newItems } = await pool.query(
    `SELECT oi.unit_landed_cost_snapshot FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.organization_id = $1 AND o.external_order_id = 'SELLAVI-4900'`, [orgId]);
  assert.equal(newItems[0].unit_landed_cost_snapshot, '16.100000');

  // The OLD order's snapshot is untouched — even when replayed after the reprice.
  await withTransaction(pool, (c) =>
    ingestSellaviOrder(c, { organizationId: orgId, payload: ORDER_4852 }));
  const { rows: oldItems } = await pool.query(
    `SELECT oi.unit_landed_cost_snapshot, oi.line_cogs FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.organization_id = $1 AND o.external_order_id = 'SELLAVI-4852'`, [orgId]);
  assert.equal(oldItems[0].unit_landed_cost_snapshot, '14.852250');
  assert.equal(oldItems[0].line_cogs, '29.704500');
});

test('missing supplier price: PRICE_NEEDED line, no invented COGS', async (t) => {
  if (!requireDb(t)) return;
  await withTransaction(pool, (c) =>
    ingestSellaviOrder(c, {
      organizationId: orgId,
      payload: {
        externalOrderId: 'SELLAVI-5000',
        subtotal: '99.00',
        orderedAt: T3,
        items: [{ sku: 'TESA-IPA-5MG-5MG', quantity: 1, unitPrice: '99.00' }],
      },
    }));
  const { rows } = await pool.query(
    `SELECT oi.cost_snapshot_status, oi.unit_landed_cost_snapshot, oi.line_cogs
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.organization_id = $1 AND o.external_order_id = 'SELLAVI-5000'`, [orgId]);
  assert.equal(rows[0].cost_snapshot_status, 'PRICE_NEEDED');
  assert.equal(rows[0].unit_landed_cost_snapshot, null);
  assert.equal(rows[0].line_cogs, null);

  const fin = await withTransaction(pool, async (c) => {
    const { rows: o } = await c.query(
      `SELECT id FROM orders WHERE organization_id = $1 AND external_order_id = 'SELLAVI-5000'`,
      [orgId]);
    return calculateOrderFinancials(c, { organizationId: orgId, orderId: o[0].id });
  });
  assert.equal(fin.cogs_status, 'PARTIAL_PRICE_NEEDED');
  assert.equal(fin.product_cogs, '0.000000');
});

test('conversions + MLM commission ledger: idempotent, one row per level', async (t) => {
  if (!requireDb(t)) return;
  // Affiliate tree: seller -> sponsor (L2) -> grand-sponsor (L3)
  const ids = {};
  await withTransaction(pool, async (c) => {
    ids.seller = (await upsertAffiliate(c, {
      organizationId: orgId, externalTapfiliateId: 'tap-seller',
      externalReferralCode: 'SELLER1', name: 'Seller One', email: 'seller@example.com',
      affiliateGroup: 'tier-1',
    })).affiliateId;
    ids.sponsor = (await upsertAffiliate(c, {
      organizationId: orgId, externalTapfiliateId: 'tap-sponsor', name: 'Sponsor',
      teamBuilder: true,
    })).affiliateId;
    ids.grand = (await upsertAffiliate(c, {
      organizationId: orgId, externalTapfiliateId: 'tap-grand', name: 'Grand Sponsor',
    })).affiliateId;
    await setSponsor(c, { organizationId: orgId, affiliateId: ids.seller, parentAffiliateId: ids.sponsor });
    await setSponsor(c, { organizationId: orgId, affiliateId: ids.sponsor, parentAffiliateId: ids.grand });
  });

  // Replaying the affiliate upsert must not duplicate.
  const replayed = await withTransaction(pool, (c) =>
    upsertAffiliate(c, { organizationId: orgId, externalTapfiliateId: 'tap-seller' }));
  assert.equal(replayed.created, false);

  // Conversion for order 4852 — twice (webhook replay).
  const conv = { organizationId: orgId, externalConversionId: 'tap-conv-1001',
    externalOrderId: 'SELLAVI-4852', affiliateId: ids.seller,
    conversionAmount: '300.00', status: 'approved', convertedAt: T1 };
  const first = await withTransaction(pool, (c) => ingestConversion(c, conv));
  const second = await withTransaction(pool, (c) => ingestConversion(c, conv));
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.ok(first.orderId, 'conversion linked to the Sellavi order');
  const { rows: convCount } = await pool.query(
    `SELECT count(*) FROM conversions WHERE organization_id = $1 AND external_conversion_id = 'tap-conv-1001'`,
    [orgId]);
  assert.equal(convCount[0].count, '1');
  ids.conversionId = first.conversionId;

  // Commission ledger: DIRECT 20% = 60, L2 3% = 9, L3 2% = 6 — each its own row.
  const mk = (affiliateId, type, rate, amount, ext) => ({
    organizationId: orgId, conversionId: ids.conversionId, affiliateId,
    commissionType: type, commissionRate: rate, commissionAmount: amount,
    status: 'approved', externalCommissionId: ext,
  });
  await withTransaction(pool, async (c) => {
    ids.direct = (await recordCommission(c, mk(ids.seller, 'DIRECT', '0.20', '60.00', 'tap-com-1'))).commissionId;
    ids.l2 = (await recordCommission(c, mk(ids.sponsor, 'MLM_LEVEL_2', '0.03', '9.00', 'tap-com-2'))).commissionId;
    ids.l3 = (await recordCommission(c, mk(ids.grand, 'MLM_LEVEL_3', '0.02', '6.00', 'tap-com-3'))).commissionId;
  });

  // Duplicate protection — by external id AND by (conversion, affiliate, type).
  const dupExt = await withTransaction(pool, (c) =>
    recordCommission(c, mk(ids.seller, 'DIRECT', '0.20', '60.00', 'tap-com-1')));
  assert.equal(dupExt.created, false);
  const dupNat = await withTransaction(pool, (c) =>
    recordCommission(c, { ...mk(ids.seller, 'DIRECT', '0.20', '60.00', null) }));
  assert.equal(dupNat.created, false);
  // A second DIRECT with a DIFFERENT external id is an integrity violation, loud:
  await assert.rejects(
    withTransaction(pool, (c) =>
      recordCommission(c, mk(ids.seller, 'DIRECT', '0.20', '60.00', 'tap-com-99'))),
    /duplicate key/
  );

  const { rows: ledger } = await pool.query(
    `SELECT commission_type, commission_rate, commission_amount FROM commissions
     WHERE organization_id = $1 AND conversion_id = $2 ORDER BY commission_type`,
    [orgId, ids.conversionId]);
  assert.deepEqual(
    ledger.map((r) => [r.commission_type, r.commission_rate, r.commission_amount]),
    [
      ['DIRECT', '0.200000', '60.000000'],
      ['MLM_LEVEL_2', '0.030000', '9.000000'],
      ['MLM_LEVEL_3', '0.020000', '6.000000'],
    ]
  );

  // Same external conversion id in ANOTHER org is allowed (org-scoped unique).
  await withTransaction(pool, (c) =>
    ingestConversion(c, { organizationId: org2Id, externalConversionId: 'tap-conv-1001',
      conversionAmount: '10.00' }));

  globalThis.__ids = ids; // share with later sequential tests
});

test('order financials: profit calculation, merchant fee NOT_CONFIGURED', async (t) => {
  if (!requireDb(t)) return;
  const ids = globalThis.__ids;
  const fin = await withTransaction(pool, async (c) => {
    const { rows: o } = await c.query(
      `SELECT id FROM orders WHERE organization_id = $1 AND external_order_id = 'SELLAVI-4852'`,
      [orgId]);
    ids.orderId = o[0].id;
    return calculateOrderFinancials(c, { organizationId: orgId, orderId: o[0].id });
  });
  assert.equal(fin.gross_revenue, '300.000000');
  assert.equal(fin.net_revenue, '300.000000');
  assert.equal(fin.product_cogs, '29.704500');
  assert.equal(fin.logistics_cost, '3.874500'); // inside COGS, displayed separately
  assert.equal(fin.merchant_processing_fee, null); // NOT invented
  assert.equal(fin.merchant_fee_status, 'NOT_CONFIGURED');
  assert.equal(fin.direct_affiliate_commission, '60.000000');
  assert.equal(fin.mlm_commission, '15.000000');
  assert.equal(fin.total_affiliate_expense, '75.000000');
  assert.equal(fin.gross_profit, '270.295500');
  assert.equal(fin.net_profit, '195.295500'); // logistics NOT double-counted
  assert.equal(fin.net_margin, '0.650985');
  assert.equal(fin.cogs_status, 'COMPLETE');
});

test('refund: net revenue drops once, financials recompute correctly', async (t) => {
  if (!requireDb(t)) return;
  const ids = globalThis.__ids;
  await withTransaction(pool, (c) =>
    ingestSellaviOrder(c, {
      organizationId: orgId,
      payload: { ...ORDER_4852, refundTotal: '50.00', financialStatus: 'PARTIALLY_REFUNDED' },
    }));
  const fin = await withTransaction(pool, (c) =>
    calculateOrderFinancials(c, { organizationId: orgId, orderId: ids.orderId }));
  assert.equal(fin.refunds, '50.000000');
  assert.equal(fin.net_revenue, '250.000000');
  // 250 − 29.7045 − 75 (refund subtracted exactly once):
  assert.equal(fin.net_profit, '145.295500');
});

test('commission reversal: negative ledger row, original reversed, no double reversal', async (t) => {
  if (!requireDb(t)) return;
  const ids = globalThis.__ids;
  const { reversalId } = await withTransaction(pool, (c) =>
    reverseCommission(c, {
      organizationId: orgId, commissionId: ids.l2, reason: 'order partially refunded',
    }));
  const { rows } = await pool.query(`SELECT * FROM commissions WHERE id = $1`, [reversalId]);
  assert.equal(rows[0].commission_type, 'REVERSAL');
  assert.equal(rows[0].commission_amount, '-9.000000');
  assert.equal(rows[0].reversed_commission_id, ids.l2);
  const { rows: orig } = await pool.query(`SELECT status FROM commissions WHERE id = $1`, [ids.l2]);
  assert.equal(orig[0].status, 'reversed');

  await assert.rejects(
    withTransaction(pool, (c) =>
      reverseCommission(c, { organizationId: orgId, commissionId: ids.l2 })),
    /already reversed/
  );

  // Financials now net MLM expense to 6.00 (15 − 9 reversal).
  const fin = await withTransaction(pool, (c) =>
    calculateOrderFinancials(c, { organizationId: orgId, orderId: ids.orderId }));
  assert.equal(fin.mlm_commission, '6.000000');
  assert.equal(fin.total_affiliate_expense, '66.000000');

  // Audit trail exists for the reversal.
  const { rows: audits } = await pool.query(
    `SELECT count(*) FROM audit_log
     WHERE organization_id = $1 AND action = 'commission.reversed' AND entity_id = $2`,
    [orgId, ids.l2]);
  assert.equal(audits[0].count, '1');
});

test('protected affiliate: automation skips, event recorded, group untouched', async (t) => {
  if (!requireDb(t)) return;
  const protectedId = await withTransaction(pool, async (c) => {
    const { affiliateId } = await upsertAffiliate(c, {
      organizationId: orgId, externalTapfiliateId: 'tap-protected',
      name: 'Protected Partner', affiliateGroup: 'legacy-15', protectedGroup: true,
    });
    return affiliateId;
  });
  const result = await withTransaction(pool, (c) =>
    applyGroupChange(c, {
      organizationId: orgId, affiliateId: protectedId, newGroup: 'tier-2',
    }));
  assert.equal(result.changed, false);
  assert.equal(result.skippedProtected, true);

  const { rows } = await pool.query(
    `SELECT affiliate_group, protected_group FROM affiliates WHERE id = $1`, [protectedId]);
  assert.equal(rows[0].affiliate_group, 'legacy-15');
  assert.equal(rows[0].protected_group, true);

  const { rows: events } = await pool.query(
    `SELECT count(*) FROM automation_events
     WHERE organization_id = $1 AND event_type = 'PROTECTED_GROUP_SKIPPED'
       AND entity_id = $2 AND status = 'SKIPPED'`, [orgId, protectedId]);
  assert.equal(events[0].count, '1');
});

test('unprotected group change: applied with audit log + automation event', async (t) => {
  if (!requireDb(t)) return;
  const ids = globalThis.__ids;
  const result = await withTransaction(pool, (c) =>
    applyGroupChange(c, {
      organizationId: orgId, affiliateId: ids.seller, newGroup: 'tier-2',
      actorType: 'SYSTEM', reason: 'monthly tier evaluation',
    }));
  assert.equal(result.changed, true);
  assert.equal(result.previousGroup, 'tier-1');

  const { rows: audits } = await pool.query(
    `SELECT before_json, after_json FROM audit_log
     WHERE organization_id = $1 AND action = 'affiliate.group_changed' AND entity_id = $2`,
    [orgId, ids.seller]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].before_json.affiliate_group, 'tier-1');
  assert.equal(audits[0].after_json.affiliate_group, 'tier-2');

  const { rows: events } = await pool.query(
    `SELECT count(*) FROM automation_events
     WHERE organization_id = $1 AND event_type = 'AFFILIATE_GROUP_CHANGED' AND entity_id = $2`,
    [orgId, ids.seller]);
  assert.equal(events[0].count, '1');
});

test('payouts: Zelle is MANUAL_ONLY, commissions cannot be double-paid', async (t) => {
  if (!requireDb(t)) return;
  const ids = globalThis.__ids;
  const { payoutId, totalAmount, automationCapability } = await withTransaction(pool, (c) =>
    createPayout(c, {
      organizationId: orgId, affiliateId: ids.seller,
      payoutMethod: 'ZELLE', commissionIds: [ids.direct],
    }));
  assert.equal(totalAmount, '60.000000');
  assert.equal(automationCapability, 'MANUAL_ONLY'); // no supported Zelle API

  // The same commission cannot enter a second payout (DB-level guard).
  await assert.rejects(
    withTransaction(pool, (c) =>
      createPayout(c, {
        organizationId: orgId, affiliateId: ids.seller,
        payoutMethod: 'PAYPAL', commissionIds: [ids.direct],
      })),
    /duplicate key|payable/ // status guard or unique constraint — either stops it
  );

  await withTransaction(pool, (c) =>
    settlePayout(c, { organizationId: orgId, payoutId }));
  const { rows } = await pool.query(
    `SELECT status, paid_at FROM commissions WHERE id = $1`, [ids.direct]);
  assert.equal(rows[0].status, 'paid');
  assert.ok(rows[0].paid_at);

  const { rows: events } = await pool.query(
    `SELECT event_type FROM automation_events
     WHERE organization_id = $1 AND entity_type = 'payouts' AND entity_id = $2
     ORDER BY event_type`, [orgId, payoutId]);
  assert.deepEqual(events.map((e) => e.event_type), ['PAYOUT_CREATED', 'PAYOUT_SETTLED']);

  // A paid commission can never be paid again.
  await assert.rejects(
    withTransaction(pool, (c) =>
      createPayout(c, {
        organizationId: orgId, affiliateId: ids.seller,
        payoutMethod: 'ZELLE', commissionIds: [ids.direct],
      })),
    /'paid'|duplicate key/
  );
});

test('automation events: unknown types rejected, org-scoped uniqueness holds', async (t) => {
  if (!requireDb(t)) return;
  await assert.rejects(
    pool.query(
      `INSERT INTO automation_events (organization_id, event_type) VALUES ($1, 'NOT_A_TYPE')`,
      [orgId]),
    /check constraint|violates/
  );
  // The same external event id exists once per org (org1 ingest + org2 ingest),
  // and replaying it into either org is a no-op.
  const replay = await withTransaction(pool, async (c) => {
    const { recordAutomationEvent } = await import('../src/services/events.js');
    return recordAutomationEvent(c, {
      organizationId: org2Id, eventType: 'ORDER_IMPORTED', sourceSystem: 'SELLAVI',
      externalEventId: 'order-import:SELLAVI-4852',
    });
  });
  assert.equal(replay.created, false);
  const { rows: perOrg } = await pool.query(
    `SELECT organization_id, count(*) FROM automation_events
     WHERE source_system = 'SELLAVI' AND external_event_id = 'order-import:SELLAVI-4852'
     GROUP BY organization_id`);
  assert.equal(perOrg.length, 2);
  for (const r of perOrg) assert.equal(r.count, '1');
});

test('secret redaction: sensitive keys never reach payload_json', async (t) => {
  if (!requireDb(t)) return;
  await withTransaction(pool, async (c) => {
    const { recordAutomationEvent } = await import('../src/services/events.js');
    await recordAutomationEvent(c, {
      organizationId: orgId, eventType: 'WEBHOOK_RECEIVED', sourceSystem: 'SELLAVI',
      externalEventId: 'redaction-test-1',
      payload: {
        order: 'SELLAVI-1',
        api_key: 'sk_live_supersecret',
        nested: { authorization: 'Bearer abc', card_number: '4111111111111111' },
      },
    });
  });
  const { rows } = await pool.query(
    `SELECT payload_json FROM automation_events
     WHERE organization_id = $1 AND external_event_id = 'redaction-test-1'`, [orgId]);
  const p = rows[0].payload_json;
  assert.equal(p.order, 'SELLAVI-1');
  assert.equal(p.api_key, '[REDACTED]');
  assert.equal(p.nested.authorization, '[REDACTED]');
  assert.equal(p.nested.card_number, '[REDACTED]');
});
