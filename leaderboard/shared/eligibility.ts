import type { EligibilityPolicy, EligibleResult, Txn } from "./types";

/**
 * The single place eligible revenue is computed. Everything that ranks or
 * qualifies anyone — leaderboards, team rollups, challenge paths — must go
 * through this function so the policy stays consistent and configurable.
 *
 * Policy (PROPOSED, pending owner confirmation): paid product revenue after
 * discounts and refunds, excluding tax and shipping. A source conversion is
 * not proof of payment: `requireVerifiedPayment` demands the payment adapter
 * or an admin verification before a cent counts.
 */
export function eligibleAmount(txn: Txn, policy: EligibilityPolicy): EligibleResult {
  if (txn.paymentStatus === "refunded") {
    return { eligible: false, amountCents: 0, reason: "refunded" };
  }
  if (txn.paymentStatus === "unpaid") {
    return { eligible: false, amountCents: 0, reason: "unpaid" };
  }
  if (txn.paymentStatus === "pending") {
    return { eligible: false, amountCents: 0, reason: "payment_pending_verification" };
  }
  if (policy.requireVerifiedPayment && !txn.paymentVerified) {
    return { eligible: false, amountCents: 0, reason: "payment_pending_verification" };
  }

  let amount = txn.grossCents;
  if (policy.netOfDiscounts) amount -= txn.discountCents;
  if (!policy.excludeTax) amount += txn.taxCents;
  if (!policy.excludeShipping) amount += txn.shippingCents;
  if (policy.netOfRefunds) amount -= txn.refundedCents;

  if (amount <= 0) {
    return { eligible: false, amountCents: 0, reason: "zero_after_adjustments" };
  }
  return { eligible: true, amountCents: amount, reason: null };
}

export interface Totals {
  amountCents: number;
  orders: number;
}

/** Sum eligible revenue for transactions inside [startMs, endMs). */
export function totalsInRange(
  txns: Iterable<Txn>,
  policy: EligibilityPolicy,
  range: { startMs: number; endMs: number | null },
): Totals {
  let amountCents = 0;
  let orders = 0;
  for (const txn of txns) {
    const t = Date.parse(txn.occurredAt);
    if (t < range.startMs || (range.endMs !== null && t >= range.endMs)) continue;
    const r = eligibleAmount(txn, policy);
    if (r.eligible) {
      amountCents += r.amountCents;
      orders += 1;
    }
  }
  return { amountCents, orders };
}
