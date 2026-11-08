import { describe, expect, it } from "vitest";
import { budgetState, continueAmount, decideSpend, WARNING_AT } from "@/server/budgets/rules";

const base = { limitUsd: 1000, threshold: 0.75, approvedExtraUsd: 0 };

describe("budgetState: the 75% rule", () => {
  it("is OK well below the threshold", () => {
    const s = budgetState({ ...base, spentUsd: 100 });
    expect(s.status).toBe("OK");
    expect(s.locked).toBe(false);
    expect(s.thresholdUsd).toBe(750);
    expect(s.headroomUsd).toBe(650);
  });

  it(`warns from ${WARNING_AT * 100}% while spending is still allowed`, () => {
    const s = budgetState({ ...base, spentUsd: 600 });
    expect(s.status).toBe("WARNING");
    expect(s.locked).toBe(false);
  });

  it("locks exactly at 75% of the limit", () => {
    expect(budgetState({ ...base, spentUsd: 749.99 }).locked).toBe(false);
    const at = budgetState({ ...base, spentUsd: 750 });
    expect(at.locked).toBe(true);
    expect(at.reachedThreshold).toBe(true);
    expect(at.status).toBe("LOCKED");
    expect(at.headroomUsd).toBe(0);
  });

  it("approved money reopens a locked budget only by that amount", () => {
    const s = budgetState({ ...base, spentUsd: 800, approvedExtraUsd: 200 });
    expect(s.locked).toBe(false);
    expect(s.status).toBe("WARNING");
    expect(s.allowanceUsd).toBe(950);
    expect(s.headroomUsd).toBe(150);
    expect(budgetState({ ...base, spentUsd: 950, approvedExtraUsd: 200 }).locked).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(budgetState({ ...base, threshold: 0.5, spentUsd: 500 }).locked).toBe(true);
  });
});

describe("decideSpend", () => {
  it("allows a purchase that stays under the approval point", () => {
    expect(decideSpend({ ...base, spentUsd: 500 }, 200)).toEqual({ allowed: true });
  });

  it("refuses a purchase that would cross 75%, before it happens", () => {
    expect(decideSpend({ ...base, spentUsd: 500 }, 300)).toEqual({
      allowed: false,
      reason: "WOULD_CROSS_THRESHOLD",
    });
  });

  it("refuses everything, including model calls, once locked", () => {
    expect(decideSpend({ ...base, spentUsd: 760 }, 0)).toEqual({
      allowed: false,
      reason: "LOCKED",
    });
    expect(decideSpend({ ...base, spentUsd: 760 }, 5)).toEqual({
      allowed: false,
      reason: "LOCKED",
    });
  });

  it("allows model calls (unknown cost) until the lock", () => {
    expect(decideSpend({ ...base, spentUsd: 749 }, 0)).toEqual({ allowed: true });
  });
});

describe("continueAmount", () => {
  it("asks for what is left up to the limit", () => {
    expect(continueAmount({ ...base, spentUsd: 780 })).toBe(220);
  });
  it("asks for at least a tenth of the limit when already at or over it", () => {
    expect(continueAmount({ ...base, spentUsd: 1050 })).toBe(100);
  });
  it("covers a specific purchase that is larger", () => {
    expect(continueAmount({ ...base, spentUsd: 700 }, 400)).toBe(400);
  });
});
