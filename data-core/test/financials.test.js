import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeOrderFinancials } from '../src/financials.js';

// Base scenario: 2 vials of Retatrutide 10mg at $150 each.
// Landed cost snapshot per vial: 14.85225 (base 12.915 + logistics 1.93725).
const BASE_ORDER = {
  subtotal: '300.00',
  discountTotal: '0',
  refundTotal: '0',
  items: [
    {
      quantity: 2,
      unitSalePrice: '150.00',
      unitLandedCost: '14.852250',
      unitBaseCost: '12.915000',
    },
  ],
  directCommission: '60.00', // e.g. 20% personal rate
  mlmCommission: '15.00',    // 3% L2 (9.00) + 2% L3 (6.00)
  merchantFeePercentage: null,
  merchantFeeFixed: null,
};

test('financials: profit calculation with exact landed COGS', () => {
  const f = computeOrderFinancials(BASE_ORDER);
  assert.equal(f.grossRevenue, '300.000000');
  assert.equal(f.netRevenue, '300.000000');
  assert.equal(f.productCogs, '29.704500');   // 2 × 14.85225
  assert.equal(f.logisticsCost, '3.874500');  // 2 × 1.93725 — inside COGS
  assert.equal(f.grossProfit, '270.295500');  // 300 − 29.7045
  assert.equal(f.totalAffiliateExpense, '75.000000');
  assert.equal(f.netProfit, '195.295500');    // 270.2955 − 75
  assert.equal(f.netMargin, '0.650985');      // 195.2955 / 300
  assert.equal(f.cogsStatus, 'COMPLETE');
});

test('financials: logistics is never subtracted twice', () => {
  const f = computeOrderFinancials(BASE_ORDER);
  // net profit must equal netRevenue − landedCOGS − commissions (fee = 0).
  // If logistics were subtracted again it would be 191.421 instead.
  assert.equal(f.netProfit, '195.295500');
  // and the displayed logistics component is exactly the landed−base share:
  assert.equal(f.logisticsCost, '3.874500');
});

test('financials: merchant fee not configured -> NULL fee, flagged, treated as 0', () => {
  const f = computeOrderFinancials(BASE_ORDER);
  assert.equal(f.merchantProcessingFee, null);
  assert.equal(f.merchantFeeStatus, 'NOT_CONFIGURED');
  // No invented fee in net profit:
  assert.equal(f.netProfit, '195.295500');
});

test('financials: configured merchant fee is applied to gross revenue', () => {
  const f = computeOrderFinancials({
    ...BASE_ORDER,
    merchantFeePercentage: '0.029',
    merchantFeeFixed: '0.30',
  });
  assert.equal(f.merchantFeeStatus, 'CONFIGURED');
  assert.equal(f.merchantProcessingFee, '9.000000'); // 300×0.029 + 0.30
  assert.equal(f.netProfit, '186.295500');           // 195.2955 − 9.00
});

test('financials: refunds reduce net revenue exactly once', () => {
  const f = computeOrderFinancials({ ...BASE_ORDER, refundTotal: '50.00' });
  assert.equal(f.grossRevenue, '300.000000');
  assert.equal(f.refunds, '50.000000');
  assert.equal(f.netRevenue, '250.000000');
  // netProfit = 250 − 29.7045 − 75 (refund NOT subtracted a second time)
  assert.equal(f.netProfit, '145.295500');
});

test('financials: discounts reduce gross revenue', () => {
  const f = computeOrderFinancials({ ...BASE_ORDER, discountTotal: '30.00' });
  assert.equal(f.grossRevenue, '270.000000');
  assert.equal(f.discounts, '30.000000');
  assert.equal(f.netRevenue, '270.000000');
});

test('financials: commission reversal nets expense down', () => {
  // A −9.00 REVERSAL against the L2 commission arrives as a reduced MLM total.
  const f = computeOrderFinancials({ ...BASE_ORDER, mlmCommission: '6.00' });
  assert.equal(f.totalAffiliateExpense, '66.000000');
  assert.equal(f.netProfit, '204.295500');
});

test('financials: missing cost line -> PARTIAL_PRICE_NEEDED, no invented COGS', () => {
  const f = computeOrderFinancials({
    ...BASE_ORDER,
    items: [
      ...BASE_ORDER.items,
      { quantity: 1, unitSalePrice: '99.00', unitLandedCost: null, unitBaseCost: null },
    ],
  });
  assert.equal(f.cogsStatus, 'PARTIAL_PRICE_NEEDED');
  assert.equal(f.missingCostLines, 1);
  // COGS still only counts the priced line:
  assert.equal(f.productCogs, '29.704500');
});

test('financials: fully refunded order -> zero net revenue, null margin', () => {
  const f = computeOrderFinancials({ ...BASE_ORDER, refundTotal: '300.00' });
  assert.equal(f.netRevenue, '0.000000');
  assert.equal(f.netMargin, null);
  assert.equal(f.netProfit, '-104.704500'); // −29.7045 COGS −75 commissions
});
