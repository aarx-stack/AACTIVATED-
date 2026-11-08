/**
 * The 75% budget rule, as pure functions (unit-tested).
 *
 * Business rule: when spend reaches the budget's threshold (75% by default), management is
 * alerted and further spending in that budget needs approval.
 *
 *   allowance = limit x threshold + money executives approved after that point
 *
 * Spending is allowed while it stays within the allowance. Each approved "continue" request,
 * and each approved purchase once it is recorded, raises the allowance by its amount.
 */
import { BudgetStatus } from "@/generated/prisma/enums";

/** Budgets show a warning from this share of the limit, before the approval point. */
export const WARNING_AT = 0.6;

export interface BudgetFigures {
  limitUsd: number;
  /** Fraction of the limit where approval becomes required (0.75). */
  threshold: number;
  spentUsd: number;
  /** Sum of executive-approved spend that counts above the threshold. */
  approvedExtraUsd: number;
}

export interface BudgetState {
  ratio: number;
  thresholdUsd: number;
  allowanceUsd: number;
  /** Money that can still be spent without a new approval (never negative). */
  headroomUsd: number;
  reachedThreshold: boolean;
  /** True when no more spending is allowed until an executive approves more. */
  locked: boolean;
  status: BudgetStatus;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function budgetState(f: BudgetFigures): BudgetState {
  const thresholdUsd = cents(f.limitUsd * f.threshold);
  const allowanceUsd = cents(thresholdUsd + f.approvedExtraUsd);
  const ratio = f.limitUsd > 0 ? f.spentUsd / f.limitUsd : 1;
  const reachedThreshold = f.spentUsd >= thresholdUsd;
  const locked = f.spentUsd >= allowanceUsd;
  const status = locked
    ? BudgetStatus.LOCKED
    : reachedThreshold || ratio >= WARNING_AT
      ? BudgetStatus.WARNING
      : BudgetStatus.OK;
  return {
    ratio,
    thresholdUsd,
    allowanceUsd,
    headroomUsd: Math.max(0, cents(allowanceUsd - f.spentUsd)),
    reachedThreshold,
    locked,
    status,
  };
}

export type SpendDecision =
  { allowed: true } | { allowed: false; reason: "LOCKED" | "WOULD_CROSS_THRESHOLD" };

/**
 * May this spend go ahead without a new approval?
 * A known amount (a purchase) must fit inside the allowance. An unknown amount
 * (a model call, priced afterwards) is allowed while the budget is not locked.
 */
export function decideSpend(f: BudgetFigures, amountUsd: number): SpendDecision {
  const state = budgetState(f);
  if (state.locked) return { allowed: false, reason: "LOCKED" };
  if (amountUsd > 0 && f.spentUsd + amountUsd > state.allowanceUsd) {
    return { allowed: false, reason: "WOULD_CROSS_THRESHOLD" };
  }
  return { allowed: true };
}

/**
 * How much a "continue spending" request asks for: what is left up to the limit,
 * or a tenth of the limit if the budget is already at or over it.
 */
export function continueAmount(f: BudgetFigures, wanted = 0): number {
  const toLimit = cents(f.limitUsd - f.spentUsd);
  const floor = cents(f.limitUsd * 0.1);
  return Math.max(toLimit, floor, cents(wanted));
}
