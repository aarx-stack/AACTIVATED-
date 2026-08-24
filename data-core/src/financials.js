/**
 * Order financial model — pure, exact, side-effect free.
 *
 * Conceptual formula (docs/FINANCIAL_MODEL.md):
 *
 *   NET REVENUE
 *   - PRODUCT COGS (landed = base supplier cost + logistics allocation)
 *   - PAYMENT PROCESSING FEES (only once configured)
 *   - DIRECT AFFILIATE COMMISSIONS
 *   - MLM COMMISSIONS
 *   = NET PROFIT
 *
 * Double-count guards:
 *   - LOGISTICS: landed COGS already contains the logistics allocation, so
 *     logistics is NOT subtracted again. logisticsCost is returned separately
 *     for display only.
 *   - REFUNDS: netRevenue = grossRevenue - refunds, so refunds are NOT
 *     subtracted again. refunds is returned separately for display only.
 *
 * Merchant fees: until organization_settings carries confirmed processor terms
 * (merchant_fee_percentage / merchant_fee_fixed), the fee is NULL with status
 * NOT_CONFIGURED and net profit treats it as 0 — no invented fee.
 */

import {
  add,
  divide,
  isZero,
  multiply,
  multiplyByInt,
  subtract,
  sum,
  toDecimalString,
  toMicros,
} from './money.js';

export const MERCHANT_FEE_NOT_CONFIGURED = 'NOT_CONFIGURED';
export const MERCHANT_FEE_CONFIGURED = 'CONFIGURED';
export const COGS_COMPLETE = 'COMPLETE';
export const COGS_PARTIAL = 'PARTIAL_PRICE_NEEDED';

/**
 * @typedef {object} FinancialLineInput
 * @property {number} quantity
 * @property {string} unitSalePrice           decimal string
 * @property {string|null} unitLandedCost     landed snapshot; null = PRICE_NEEDED
 * @property {string|null} unitBaseCost       base snapshot;   null = PRICE_NEEDED
 */

/**
 * @typedef {object} OrderFinancialInput
 * @property {string} subtotal
 * @property {string} discountTotal
 * @property {string} refundTotal
 * @property {FinancialLineInput[]} items
 * @property {string} directCommission  total DIRECT commission expense for the order
 * @property {string} mlmCommission     total MLM (level 2+3) commission expense
 * @property {string|null} merchantFeePercentage  null = not configured
 * @property {string|null} merchantFeeFixed       null = not configured
 */

/**
 * Compute the full order financial breakdown. All monetary outputs are decimal
 * strings at 6dp; netMargin is a ratio at 6dp or null when net revenue is zero.
 *
 * @param {OrderFinancialInput} input
 */
export function computeOrderFinancials(input) {
  const grossRevenue = subtract(input.subtotal, input.discountTotal);
  const refunds = toMicros(input.refundTotal);
  const netRevenue = subtract(grossRevenue, refunds);

  // COGS from landed snapshots; lines without a snapshot are surfaced, not invented.
  let productCogs = 0n;
  let logisticsCost = 0n;
  let missingCostLines = 0;
  for (const line of input.items) {
    if (line.unitLandedCost == null) {
      missingCostLines += 1;
      continue;
    }
    const lineCogs = multiplyByInt(line.unitLandedCost, line.quantity);
    productCogs += lineCogs;
    if (line.unitBaseCost != null) {
      const lineBase = multiplyByInt(line.unitBaseCost, line.quantity);
      logisticsCost += lineCogs - lineBase; // logistics share INSIDE landed COGS
    }
  }

  // Merchant fee — only when configured; charged on gross revenue (amount processed).
  const feeConfigured =
    input.merchantFeePercentage != null || input.merchantFeeFixed != null;
  let merchantProcessingFee = null;
  if (feeConfigured) {
    let fee = 0n;
    if (input.merchantFeePercentage != null) {
      fee = add(fee, multiply(grossRevenue, input.merchantFeePercentage));
    }
    if (input.merchantFeeFixed != null) {
      fee = add(fee, input.merchantFeeFixed);
    }
    merchantProcessingFee = fee;
  }

  const directCommission = toMicros(input.directCommission);
  const mlmCommission = toMicros(input.mlmCommission);
  const totalAffiliateExpense = directCommission + mlmCommission;

  // Profit. Logistics is already inside productCogs — never subtracted twice.
  // Refunds are already inside netRevenue — never subtracted twice.
  const grossProfit = netRevenue - productCogs;
  const feeForProfit = merchantProcessingFee ?? 0n;
  const netProfit = grossProfit - feeForProfit - totalAffiliateExpense;
  const netMargin = isZero(netRevenue) ? null : divide(netProfit, netRevenue);

  return {
    grossRevenue: toDecimalString(grossRevenue),
    discounts: toDecimalString(toMicros(input.discountTotal)),
    netRevenue: toDecimalString(netRevenue),
    productCogs: toDecimalString(productCogs),
    logisticsCost: toDecimalString(logisticsCost),
    merchantProcessingFee:
      merchantProcessingFee == null ? null : toDecimalString(merchantProcessingFee),
    merchantFeeStatus: feeConfigured
      ? MERCHANT_FEE_CONFIGURED
      : MERCHANT_FEE_NOT_CONFIGURED,
    directAffiliateCommission: toDecimalString(directCommission),
    mlmCommission: toDecimalString(mlmCommission),
    totalAffiliateExpense: toDecimalString(totalAffiliateExpense),
    refunds: toDecimalString(refunds),
    grossProfit: toDecimalString(grossProfit),
    netProfit: toDecimalString(netProfit),
    netMargin: netMargin == null ? null : toDecimalString(netMargin),
    cogsStatus: missingCostLines > 0 ? COGS_PARTIAL : COGS_COMPLETE,
    missingCostLines,
  };
}
