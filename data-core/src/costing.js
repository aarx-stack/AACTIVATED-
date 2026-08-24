/**
 * Supplier cost engine — turns an effective-dated product_costs row into exact
 * per-vial numbers.
 *
 * Business rules (Phase 3 spec):
 *   - Supplier list prices are per KIT; vials_per_kit is 10 today but is data.
 *   - Two tiers: SMALL and BULK. AACTIVATED's default active tier is BULK.
 *   - logistics_rate (default 0.15 = shipping + labor + storage) is configurable
 *     data: cost-row override -> organization default -> never hard-coded.
 *   - Missing supplier prices are PRICE_NEEDED: no invented numbers, no
 *     substituting another strength or product.
 *
 *   base_cost_per_vial      = active_kit_cost / vials_per_kit
 *   logistics_cost_per_vial = base_cost_per_vial * logistics_rate
 *   landed_cost_per_vial    = base_cost_per_vial + logistics_cost_per_vial
 */

import { add, divide, multiply, toDecimalString, toMicros } from './money.js';

export const COST_TIERS = Object.freeze(['SMALL', 'BULK']);
export const PRICE_NEEDED = 'PRICE_NEEDED';
export const PRICED = 'PRICED';

/**
 * @typedef {object} CostInput
 * @property {'PRICED'|'PRICE_NEEDED'} [costStatus]
 * @property {string|null} [smallKitCost]   decimal string, e.g. "153.75"
 * @property {string|null} [bulkKitCost]    decimal string, e.g. "129.15"
 * @property {number} vialsPerKit           e.g. 10
 * @property {'SMALL'|'BULK'} activeCostTier
 * @property {string|null} [logisticsRate]  decimal string, e.g. "0.15"; null -> org default
 */

/**
 * @typedef {object} CostBreakdown
 * @property {'PRICED'|'PRICE_NEEDED'} costStatus
 * @property {'SMALL'|'BULK'} activeCostTier
 * @property {string|null} activeKitCost
 * @property {string|null} baseCostPerVial
 * @property {string|null} logisticsCostPerVial
 * @property {string|null} landedCostPerVial
 * @property {string|null} logisticsRate
 */

/**
 * Compute the per-vial cost breakdown for a cost row.
 *
 * @param {CostInput} cost
 * @param {{logisticsRate: string}} orgDefaults organization_settings fallbacks
 * @returns {CostBreakdown}
 */
export function computeCostBreakdown(cost, orgDefaults) {
  const tier = cost.activeCostTier;
  if (!COST_TIERS.includes(tier)) {
    throw new RangeError(`costing: unknown cost tier "${tier}"`);
  }
  if (!Number.isInteger(cost.vialsPerKit) || cost.vialsPerKit <= 0) {
    throw new RangeError(`costing: vials_per_kit must be a positive integer`);
  }

  const activeKitCost = tier === 'BULK' ? cost.bulkKitCost : cost.smallKitCost;

  // Explicitly-missing price, or no price for the active tier: PRICE_NEEDED.
  if (cost.costStatus === PRICE_NEEDED || activeKitCost == null) {
    return {
      costStatus: PRICE_NEEDED,
      activeCostTier: tier,
      activeKitCost: null,
      baseCostPerVial: null,
      logisticsCostPerVial: null,
      landedCostPerVial: null,
      logisticsRate: null,
    };
  }

  const rate = cost.logisticsRate ?? orgDefaults.logisticsRate;
  if (rate == null) {
    throw new RangeError(
      'costing: no logistics_rate on the cost row and no organization default'
    );
  }

  const vials = String(cost.vialsPerKit);
  const base = divide(activeKitCost, vials);
  const logistics = multiply(base, rate);
  const landed = add(base, logistics);

  return {
    costStatus: PRICED,
    activeCostTier: tier,
    activeKitCost: toDecimalString(toMicros(activeKitCost)),
    baseCostPerVial: toDecimalString(base),
    logisticsCostPerVial: toDecimalString(logistics),
    landedCostPerVial: toDecimalString(landed),
    logisticsRate: toDecimalString(toMicros(rate)),
  };
}

/**
 * Map a product_costs database row (snake_case, numeric-as-string) to a
 * breakdown, applying organization defaults.
 * @param {object} row product_costs row
 * @param {{logistics_rate: string}} settings organization_settings row
 * @returns {CostBreakdown}
 */
export function breakdownFromRow(row, settings) {
  return computeCostBreakdown(
    {
      costStatus: row.cost_status,
      smallKitCost: row.small_kit_cost,
      bulkKitCost: row.bulk_kit_cost,
      vialsPerKit:
        typeof row.vials_per_kit === 'number'
          ? row.vials_per_kit
          : parseInt(row.vials_per_kit, 10),
      activeCostTier: row.active_cost_tier,
      logisticsRate: row.logistics_rate,
    },
    { logisticsRate: settings.logistics_rate }
  );
}
