import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeCostBreakdown, breakdownFromRow } from '../src/costing.js';

const ORG_DEFAULTS = { logisticsRate: '0.15' };

// The canonical Phase 3 example: Retatrutide 10mg.
const RETATRUTIDE = {
  costStatus: 'PRICED',
  smallKitCost: '153.75',
  bulkKitCost: '129.15',
  vialsPerKit: 10,
  activeCostTier: 'BULK',
  logisticsRate: null,
};

test('costing: Retatrutide 10mg BULK matches the spec example exactly', () => {
  const b = computeCostBreakdown(RETATRUTIDE, ORG_DEFAULTS);
  assert.equal(b.costStatus, 'PRICED');
  assert.equal(b.activeKitCost, '129.150000');
  assert.equal(b.baseCostPerVial, '12.915000');       // 129.15 / 10
  assert.equal(b.logisticsCostPerVial, '1.937250');   // * 0.15
  assert.equal(b.landedCostPerVial, '14.852250');     // base + logistics
  assert.equal(b.logisticsRate, '0.150000');
});

test('costing: SMALL tier uses the small kit price', () => {
  const b = computeCostBreakdown(
    { ...RETATRUTIDE, activeCostTier: 'SMALL' },
    ORG_DEFAULTS
  );
  assert.equal(b.activeKitCost, '153.750000');
  assert.equal(b.baseCostPerVial, '15.375000');      // 153.75 / 10
  assert.equal(b.logisticsCostPerVial, '2.306250');  // * 0.15
  assert.equal(b.landedCostPerVial, '17.681250');
});

test('costing: bulk vs small produce different landed costs', () => {
  const bulk = computeCostBreakdown(RETATRUTIDE, ORG_DEFAULTS);
  const small = computeCostBreakdown(
    { ...RETATRUTIDE, activeCostTier: 'SMALL' },
    ORG_DEFAULTS
  );
  assert.notEqual(bulk.landedCostPerVial, small.landedCostPerVial);
});

test('costing: cost-row logistics override beats the org default', () => {
  const b = computeCostBreakdown(
    { ...RETATRUTIDE, logisticsRate: '0.10' },
    ORG_DEFAULTS
  );
  assert.equal(b.logisticsCostPerVial, '1.291500'); // 12.915 * 0.10
  assert.equal(b.landedCostPerVial, '14.206500');
});

test('costing: zero logistics rate means landed == base', () => {
  const b = computeCostBreakdown(
    { ...RETATRUTIDE, logisticsRate: '0' },
    ORG_DEFAULTS
  );
  assert.equal(b.landedCostPerVial, b.baseCostPerVial);
});

test('costing: explicit PRICE_NEEDED yields no numbers (Tesamorelin/Ipamorelin 5mg/5mg)', () => {
  const b = computeCostBreakdown(
    {
      costStatus: 'PRICE_NEEDED',
      smallKitCost: null,
      bulkKitCost: null,
      vialsPerKit: 10,
      activeCostTier: 'BULK',
      logisticsRate: null,
    },
    ORG_DEFAULTS
  );
  assert.equal(b.costStatus, 'PRICE_NEEDED');
  assert.equal(b.baseCostPerVial, null);
  assert.equal(b.logisticsCostPerVial, null);
  assert.equal(b.landedCostPerVial, null);
});

test('costing: missing price for the ACTIVE tier is PRICE_NEEDED, never substituted', () => {
  // Bulk tier active but only the small price exists: must NOT fall back to small.
  const b = computeCostBreakdown(
    { ...RETATRUTIDE, bulkKitCost: null },
    ORG_DEFAULTS
  );
  assert.equal(b.costStatus, 'PRICE_NEEDED');
  assert.equal(b.landedCostPerVial, null);
});

test('costing: breakdownFromRow maps a database row with org settings fallback', () => {
  const b = breakdownFromRow(
    {
      cost_status: 'PRICED',
      small_kit_cost: '153.750000',
      bulk_kit_cost: '129.150000',
      vials_per_kit: 10,
      active_cost_tier: 'BULK',
      logistics_rate: null,
    },
    { logistics_rate: '0.150000' }
  );
  assert.equal(b.landedCostPerVial, '14.852250');
});

test('costing: invalid inputs throw', () => {
  assert.throws(() =>
    computeCostBreakdown({ ...RETATRUTIDE, activeCostTier: 'MEDIUM' }, ORG_DEFAULTS)
  );
  assert.throws(() =>
    computeCostBreakdown({ ...RETATRUTIDE, vialsPerKit: 0 }, ORG_DEFAULTS)
  );
});
