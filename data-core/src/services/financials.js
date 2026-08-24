/**
 * Order financials service — assembles inputs from the database, delegates the
 * math to the pure calculator (src/financials.js), and upserts order_financials.
 *
 * Commission attribution: commissions reach an order through its conversions
 * (order -> conversions -> commissions). DIRECT feeds direct_affiliate_commission;
 * MLM_LEVEL_2/3 feed mlm_commission; REVERSAL rows subtract from whichever bucket
 * their reversed commission belonged to; disapproved commissions are excluded.
 */

import { computeOrderFinancials } from '../financials.js';
import { getOrganizationSettings } from '../db.js';
import { recordAutomationEvent } from './events.js';

/**
 * Recalculate and store order_financials for one order.
 * @param {import('pg').PoolClient} client
 * @param {object} args
 * @param {string} args.organizationId
 * @param {string} args.orderId
 * @returns {Promise<object>} the stored order_financials row
 */
export async function calculateOrderFinancials(client, { organizationId, orderId }) {
  const { rows: orders } = await client.query(
    `SELECT * FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, organizationId]
  );
  if (orders.length === 0) {
    throw new Error(`financials: order ${orderId} not found in organization`);
  }
  const order = orders[0];

  const { rows: items } = await client.query(
    `SELECT quantity, unit_sale_price, unit_base_cost_snapshot,
            unit_landed_cost_snapshot, cost_snapshot_status
     FROM order_items WHERE order_id = $1 ORDER BY line_number`,
    [orderId]
  );

  // Commission expense via this order's conversions. REVERSAL amounts are
  // negative, so summing them into the original bucket nets the expense out.
  const { rows: commissionSums } = await client.query(
    `SELECT
       COALESCE(sum(CASE
         WHEN c.commission_type = 'DIRECT'
           OR (c.commission_type = 'REVERSAL' AND orig.commission_type = 'DIRECT')
         THEN c.commission_amount END), 0)::text AS direct_total,
       COALESCE(sum(CASE
         WHEN c.commission_type IN ('MLM_LEVEL_2', 'MLM_LEVEL_3')
           OR (c.commission_type = 'REVERSAL'
               AND orig.commission_type IN ('MLM_LEVEL_2', 'MLM_LEVEL_3'))
         THEN c.commission_amount END), 0)::text AS mlm_total
     FROM commissions c
     LEFT JOIN commissions orig ON orig.id = c.reversed_commission_id
     WHERE c.organization_id = $1
       AND c.status <> 'disapproved'
       AND c.conversion_id IN (
         SELECT id FROM conversions WHERE order_id = $2 AND organization_id = $1
       )`,
    [organizationId, orderId]
  );

  const settings = await getOrganizationSettings(client, organizationId);

  const result = computeOrderFinancials({
    subtotal: order.subtotal,
    discountTotal: order.discount_total,
    refundTotal: order.refund_total,
    items: items.map((i) => ({
      quantity: typeof i.quantity === 'number' ? i.quantity : parseInt(i.quantity, 10),
      unitSalePrice: i.unit_sale_price,
      unitLandedCost: i.unit_landed_cost_snapshot,
      unitBaseCost: i.unit_base_cost_snapshot,
    })),
    directCommission: commissionSums[0].direct_total,
    mlmCommission: commissionSums[0].mlm_total,
    merchantFeePercentage: settings.merchant_fee_percentage,
    merchantFeeFixed: settings.merchant_fee_fixed,
  });

  const { rows: stored } = await client.query(
    `INSERT INTO order_financials
       (organization_id, order_id, currency, gross_revenue, discounts, net_revenue,
        product_cogs, logistics_cost, merchant_processing_fee, merchant_fee_status,
        direct_affiliate_commission, mlm_commission, total_affiliate_expense,
        refunds, gross_profit, net_profit, net_margin, cogs_status, calculated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, now())
     ON CONFLICT (order_id) DO UPDATE SET
       currency                    = EXCLUDED.currency,
       gross_revenue               = EXCLUDED.gross_revenue,
       discounts                   = EXCLUDED.discounts,
       net_revenue                 = EXCLUDED.net_revenue,
       product_cogs                = EXCLUDED.product_cogs,
       logistics_cost              = EXCLUDED.logistics_cost,
       merchant_processing_fee     = EXCLUDED.merchant_processing_fee,
       merchant_fee_status         = EXCLUDED.merchant_fee_status,
       direct_affiliate_commission = EXCLUDED.direct_affiliate_commission,
       mlm_commission              = EXCLUDED.mlm_commission,
       total_affiliate_expense     = EXCLUDED.total_affiliate_expense,
       refunds                     = EXCLUDED.refunds,
       gross_profit                = EXCLUDED.gross_profit,
       net_profit                  = EXCLUDED.net_profit,
       net_margin                  = EXCLUDED.net_margin,
       cogs_status                 = EXCLUDED.cogs_status,
       calculated_at               = now()
     RETURNING *`,
    [
      organizationId,
      orderId,
      order.currency,
      result.grossRevenue,
      result.discounts,
      result.netRevenue,
      result.productCogs,
      result.logisticsCost,
      result.merchantProcessingFee,
      result.merchantFeeStatus,
      result.directAffiliateCommission,
      result.mlmCommission,
      result.totalAffiliateExpense,
      result.refunds,
      result.grossProfit,
      result.netProfit,
      result.netMargin,
      result.cogsStatus,
    ]
  );

  await recordAutomationEvent(client, {
    organizationId,
    eventType: 'FINANCIAL_CALCULATED',
    sourceSystem: 'DATA_CORE',
    entityType: 'orders',
    entityId: orderId,
    status: 'SUCCESS',
    payload: {
      net_profit: result.netProfit,
      cogs_status: result.cogsStatus,
      merchant_fee_status: result.merchantFeeStatus,
    },
  });

  return stored[0];
}
