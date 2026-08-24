/**
 * Sellavi order ingestion.
 *
 * Sellavi stays the commerce system of record (do not replace); the Data Core
 * consolidates its orders for financials and history. Ingestion is IDEMPOTENT:
 *   - orders upsert on (organization_id, source='SELLAVI', external_order_id)
 *   - items upsert on (order_id, line_number)
 * so webhook replays and re-imports can only converge, never duplicate.
 *
 * COGS snapshot: at ingest time each line looks up the product's cost window in
 * force at ordered_at and freezes unit_base/landed_cost_snapshot + line_cogs.
 * Existing lines' snapshots are NEVER overwritten on replay — historical profit
 * does not change when supplier pricing changes later.
 *
 * Missing supplier price => cost_snapshot_status = 'PRICE_NEEDED', line_cogs NULL.
 */

import { breakdownFromRow } from '../costing.js';
import { getOrganizationSettings } from '../db.js';
import {
  multiplyByInt,
  subtract,
  toDecimalString,
  toMicros,
} from '../money.js';
import { recordAutomationEvent } from '../services/events.js';

export const SELLAVI_SOURCE = 'SELLAVI';

/**
 * @typedef {object} SellaviOrderLine
 * @property {string|null} [externalProductId]
 * @property {string|null} [sku]
 * @property {number} quantity
 * @property {string} unitPrice decimal string
 *
 * @typedef {object} SellaviOrderPayload
 * @property {string} externalOrderId   e.g. 'SELLAVI-4852'
 * @property {string} [currency]        default 'USD'
 * @property {string} subtotal          decimal string
 * @property {string} [discountTotal]
 * @property {string} [refundTotal]
 * @property {string} [customerReference] external customer ref — never card data
 * @property {string} [orderStatus]
 * @property {string} [financialStatus]
 * @property {string|Date} [orderedAt]
 * @property {SellaviOrderLine[]} items
 */

/**
 * Find the product-cost window in force at a given time.
 * @param {import('pg').PoolClient} client
 */
async function findEffectiveCost(client, organizationId, productId, at) {
  const { rows } = await client.query(
    `SELECT * FROM product_costs
     WHERE organization_id = $1 AND product_id = $2
       AND effective_from <= $3
       AND (effective_to IS NULL OR effective_to > $3)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [organizationId, productId, at]
  );
  return rows[0] ?? null;
}

/**
 * Ingest (create or update) one Sellavi order with its items.
 *
 * @param {import('pg').PoolClient} client transaction-scoped client
 * @param {object} args
 * @param {string} args.organizationId
 * @param {SellaviOrderPayload} args.payload
 * @param {string} [args.externalEventId] webhook delivery id for event dedup
 * @returns {Promise<{orderId: string, created: boolean, priceNeededLines: number[]}>}
 */
export async function ingestSellaviOrder(client, { organizationId, payload, externalEventId }) {
  if (!payload.externalOrderId) {
    throw new Error('sellavi: payload.externalOrderId is required');
  }
  const currency = payload.currency ?? 'USD';
  const subtotal = toMicros(payload.subtotal);
  const discountTotal = toMicros(payload.discountTotal ?? '0');
  const refundTotal = toMicros(payload.refundTotal ?? '0');
  const grossRevenue = subtotal - discountTotal;
  const netRevenue = grossRevenue - refundTotal;
  const orderedAt = payload.orderedAt ?? new Date();

  const { rows: orderRows } = await client.query(
    `INSERT INTO orders
       (organization_id, external_order_id, source, customer_reference, currency,
        subtotal, discount_total, gross_revenue, refund_total, net_revenue,
        order_status, financial_status, ordered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             COALESCE($11, 'PENDING'), COALESCE($12, 'PENDING'), $13)
     ON CONFLICT (organization_id, source, external_order_id) DO UPDATE SET
       customer_reference = EXCLUDED.customer_reference,
       currency           = EXCLUDED.currency,
       subtotal           = EXCLUDED.subtotal,
       discount_total     = EXCLUDED.discount_total,
       gross_revenue      = EXCLUDED.gross_revenue,
       refund_total       = EXCLUDED.refund_total,
       net_revenue        = EXCLUDED.net_revenue,
       order_status       = COALESCE($11, orders.order_status),
       financial_status   = COALESCE($12, orders.financial_status),
       ordered_at         = COALESCE(EXCLUDED.ordered_at, orders.ordered_at)
     RETURNING id, (xmax = 0) AS created`,
    [
      organizationId,
      payload.externalOrderId,
      SELLAVI_SOURCE,
      payload.customerReference ?? null,
      currency,
      toDecimalString(subtotal),
      toDecimalString(discountTotal),
      toDecimalString(grossRevenue),
      toDecimalString(refundTotal),
      toDecimalString(netRevenue),
      payload.orderStatus ?? null,
      payload.financialStatus ?? null,
      orderedAt,
    ]
  );
  const orderId = orderRows[0].id;
  const created = orderRows[0].created === true;

  const settings = await getOrganizationSettings(client, organizationId);
  const priceNeededLines = [];

  for (let i = 0; i < (payload.items ?? []).length; i++) {
    const line = payload.items[i];
    const lineNumber = i + 1;
    const lineRevenue = multiplyByInt(line.unitPrice, line.quantity);

    // Resolve the product by Sellavi id first, then by internal SKU.
    let product = null;
    if (line.externalProductId != null) {
      const { rows } = await client.query(
        `SELECT id FROM products
         WHERE organization_id = $1 AND external_sellavi_product_id = $2`,
        [organizationId, line.externalProductId]
      );
      product = rows[0] ?? null;
    }
    if (!product && line.sku != null) {
      const { rows } = await client.query(
        `SELECT id FROM products WHERE organization_id = $1 AND sku = $2`,
        [organizationId, line.sku]
      );
      product = rows[0] ?? null;
    }

    // Cost snapshot from the window in force at ordered_at.
    let unitBase = null;
    let unitLanded = null;
    let lineCogs = null;
    let productCostId = null;
    let snapshotStatus = 'PRICE_NEEDED';
    if (product) {
      const costRow = await findEffectiveCost(client, organizationId, product.id, orderedAt);
      if (costRow) {
        productCostId = costRow.id;
        const breakdown = breakdownFromRow(costRow, settings);
        if (breakdown.costStatus === 'PRICED') {
          unitBase = breakdown.baseCostPerVial;
          unitLanded = breakdown.landedCostPerVial;
          lineCogs = toDecimalString(multiplyByInt(unitLanded, line.quantity));
          snapshotStatus = 'SNAPSHOTTED';
        }
      }
    }
    if (snapshotStatus === 'PRICE_NEEDED') priceNeededLines.push(lineNumber);

    // Replays refresh quantities/prices but never overwrite an existing cost
    // snapshot — historical COGS is frozen at first successful snapshot.
    await client.query(
      `INSERT INTO order_items
         (organization_id, order_id, line_number, product_id, external_product_id,
          sku, quantity, unit_sale_price, line_revenue,
          unit_base_cost_snapshot, unit_landed_cost_snapshot,
          cost_snapshot_status, product_cost_id, line_cogs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (order_id, line_number) DO UPDATE SET
         product_id          = COALESCE(order_items.product_id, EXCLUDED.product_id),
         external_product_id = EXCLUDED.external_product_id,
         sku                 = EXCLUDED.sku,
         quantity            = EXCLUDED.quantity,
         unit_sale_price     = EXCLUDED.unit_sale_price,
         line_revenue        = EXCLUDED.line_revenue,
         unit_base_cost_snapshot   = CASE WHEN order_items.cost_snapshot_status = 'SNAPSHOTTED'
                                          THEN order_items.unit_base_cost_snapshot
                                          ELSE EXCLUDED.unit_base_cost_snapshot END,
         unit_landed_cost_snapshot = CASE WHEN order_items.cost_snapshot_status = 'SNAPSHOTTED'
                                          THEN order_items.unit_landed_cost_snapshot
                                          ELSE EXCLUDED.unit_landed_cost_snapshot END,
         product_cost_id           = CASE WHEN order_items.cost_snapshot_status = 'SNAPSHOTTED'
                                          THEN order_items.product_cost_id
                                          ELSE EXCLUDED.product_cost_id END,
         line_cogs                 = CASE WHEN order_items.cost_snapshot_status = 'SNAPSHOTTED'
                                          THEN
                                            CASE WHEN order_items.quantity = EXCLUDED.quantity
                                                 THEN order_items.line_cogs
                                                 ELSE order_items.unit_landed_cost_snapshot * EXCLUDED.quantity
                                            END
                                          ELSE EXCLUDED.line_cogs END,
         cost_snapshot_status      = CASE WHEN order_items.cost_snapshot_status = 'SNAPSHOTTED'
                                          THEN order_items.cost_snapshot_status
                                          ELSE EXCLUDED.cost_snapshot_status END`,
      [
        organizationId,
        orderId,
        lineNumber,
        product?.id ?? null,
        line.externalProductId ?? null,
        line.sku ?? null,
        line.quantity,
        line.unitPrice,
        toDecimalString(lineRevenue),
        unitBase,
        unitLanded,
        snapshotStatus,
        productCostId,
        lineCogs,
      ]
    );
  }

  await recordAutomationEvent(client, {
    organizationId,
    eventType: 'ORDER_IMPORTED',
    sourceSystem: SELLAVI_SOURCE,
    externalEventId: externalEventId ?? `order-import:${payload.externalOrderId}`,
    entityType: 'orders',
    entityId: orderId,
    status: 'SUCCESS',
    payload: {
      external_order_id: payload.externalOrderId,
      created,
      price_needed_lines: priceNeededLines,
    },
  });

  return { orderId, created, priceNeededLines };
}
