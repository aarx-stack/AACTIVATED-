import { describe, expect, it } from "vitest";
import { eligibleAmount, totalsInRange } from "@shared/eligibility";
import { DEFAULT_POLICY } from "@shared/types";
import { txn } from "./helpers/factory";

const at = "2026-09-05T12:00:00.000Z";

describe("eligible-sales policy (paid vs unpaid, refunds, exclusions)", () => {
  it("counts verified-paid product revenue net of discounts, excluding tax & shipping", () => {
    const t = txn({
      occurredAt: at,
      grossCents: 29_700,
      discountCents: 2_970,
      taxCents: 2_299,
      shippingCents: 1_295,
    });
    const r = eligibleAmount(t, DEFAULT_POLICY);
    expect(r.eligible).toBe(true);
    expect(r.amountCents).toBe(29_700 - 2_970); // tax & shipping never included
  });

  it("excludes unpaid manual/Zelle orders entirely", () => {
    const r = eligibleAmount(
      txn({ occurredAt: at, grossCents: 25_000, paymentStatus: "unpaid", paymentVerified: false }),
      DEFAULT_POLICY,
    );
    expect(r).toEqual({ eligible: false, amountCents: 0, reason: "unpaid" });
  });

  it("excludes source-paid but unverified orders (a conversion is not proof of payment)", () => {
    const r = eligibleAmount(
      txn({ occurredAt: at, grossCents: 25_000, paymentStatus: "paid", paymentVerified: false, paymentVerifiedVia: null }),
      DEFAULT_POLICY,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("payment_pending_verification");
  });

  it("excludes pending payments until verification", () => {
    const r = eligibleAmount(
      txn({ occurredAt: at, grossCents: 250_000, paymentStatus: "pending", paymentVerified: false }),
      DEFAULT_POLICY,
    );
    expect(r.eligible).toBe(false);
  });

  it("full refund → zero; partial refund → remainder", () => {
    const full = eligibleAmount(
      txn({ occurredAt: at, grossCents: 34_900, paymentStatus: "refunded", paymentVerified: false }),
      DEFAULT_POLICY,
    );
    expect(full).toEqual({ eligible: false, amountCents: 0, reason: "refunded" });

    const part = eligibleAmount(
      txn({ occurredAt: at, grossCents: 59_400, refundedCents: 29_700, paymentStatus: "partially_refunded" }),
      DEFAULT_POLICY,
    );
    expect(part.eligible).toBe(true);
    expect(part.amountCents).toBe(29_700);
  });

  it("refund exceeding the base zeroes out instead of going negative", () => {
    const r = eligibleAmount(
      txn({ occurredAt: at, grossCents: 10_000, refundedCents: 12_000, paymentStatus: "partially_refunded" }),
      DEFAULT_POLICY,
    );
    expect(r.eligible).toBe(false);
    expect(r.amountCents).toBe(0);
  });

  it("totalsInRange counts an order once and only inside [start, end)", () => {
    const start = Date.parse("2026-09-01T07:00:00.000Z");
    const end = Date.parse("2026-10-01T07:00:00.000Z");
    const inside = txn({ occurredAt: new Date(start).toISOString(), grossCents: 10_000 });
    const atEnd = txn({ occurredAt: new Date(end).toISOString(), grossCents: 10_000 });
    const before = txn({ occurredAt: new Date(start - 1).toISOString(), grossCents: 10_000 });
    const totals = totalsInRange([inside, atEnd, before], DEFAULT_POLICY, { startMs: start, endMs: end });
    expect(totals).toEqual({ amountCents: 10_000, orders: 1 });
  });
});
