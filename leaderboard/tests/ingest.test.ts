import { describe, expect, it } from "vitest";
import { finishDelivery, recordDelivery, upsertTxn, type SourceTxn } from "@worker/domain/ingest";
import { eligibleAmount } from "@shared/eligibility";
import { DEFAULT_POLICY, type Txn } from "@shared/types";
import { openTestDb, seedAffiliate } from "./helpers/sqlite";
import type { SqlDb } from "@worker/lib/db";

const srcTxn = (over: Partial<SourceTxn> = {}): SourceTxn => ({
  id: crypto.randomUUID(),
  source: "tapfiliate",
  externalId: "order-1001",
  orderRef: "#AR-1001",
  affiliateId: "aff-1",
  occurredAt: "2026-09-05T12:00:00.000Z",
  grossCents: 29_700,
  discountCents: 0,
  taxCents: 2_554,
  shippingCents: 0,
  refundedCents: 0,
  paymentStatus: "paid",
  paymentVerified: true,
  paymentVerifiedVia: "sellavi",
  isFoundersPack: false,
  sourceUpdatedAt: "2026-09-05T12:00:00.000Z",
  ...over,
});

async function ledgerRows(db: SqlDb) {
  return db.all<{ external_id: string; gross_cents: number; refunded_cents: number; payment_status: string }>(
    "SELECT external_id, gross_cents, refunded_cents, payment_status FROM transactions",
  );
}

describe("webhook ingestion (idempotency, refunds, single counting)", () => {
  it("duplicate webhook deliveries are detected and skipped", async () => {
    const { db } = openTestDb();
    expect(await recordDelivery(db, "tapfiliate", "evt-1", "hash-a")).toBe("new");
    expect(await recordDelivery(db, "tapfiliate", "evt-1", "hash-a")).toBe("duplicate");
    // Same delivery retried by the source after a 5xx → still one processing.
    expect(await recordDelivery(db, "tapfiliate", "evt-1", "hash-a")).toBe("duplicate");
    await finishDelivery(db, "tapfiliate", "evt-1", true);
    const rows = await db.all("SELECT * FROM webhook_events");
    expect(rows).toHaveLength(1);
  });

  it("replaying the same conversion N times produces exactly one ledger row", async () => {
    const { db } = openTestDb();
    await seedAffiliate(db, "aff-1");
    expect(await upsertTxn(db, srcTxn())).toBe("inserted");
    expect(await upsertTxn(db, srcTxn())).toBe("updated"); // idempotent re-apply
    expect(await upsertTxn(db, srcTxn())).toBe("updated");
    expect(await ledgerRows(db)).toHaveLength(1);
  });

  it("multiple commission records for one order never become separate sales", async () => {
    const { db } = openTestDb();
    await seedAffiliate(db, "aff-1");
    // MLM sources emit one commission row per level for the same order; the
    // ledger keys on (source, external_id), so they converge on one row.
    for (let level = 0; level < 3; level++) {
      await upsertTxn(db, srcTxn({ id: crypto.randomUUID() }));
    }
    const rows = await ledgerRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.gross_cents).toBe(29_700);
  });

  it("a later refund update converges the same row (partial, then full)", async () => {
    const { db } = openTestDb();
    await seedAffiliate(db, "aff-1");
    await upsertTxn(db, srcTxn());
    await upsertTxn(db, srcTxn({
      refundedCents: 10_000,
      paymentStatus: "partially_refunded",
      sourceUpdatedAt: "2026-09-06T12:00:00.000Z",
    }));
    let [row] = await ledgerRows(db);
    expect(row!.refunded_cents).toBe(10_000);
    expect(row!.payment_status).toBe("partially_refunded");

    await upsertTxn(db, srcTxn({
      refundedCents: 29_700,
      paymentStatus: "refunded",
      paymentVerified: false,
      sourceUpdatedAt: "2026-09-07T12:00:00.000Z",
    }));
    [row] = await ledgerRows(db);
    expect(row!.payment_status).toBe("refunded");

    // The eligibility engine then yields the correct amounts at each stage.
    const asTxn = (partial: Partial<Txn>): Txn => ({
      id: "x", source: "tapfiliate", externalId: "order-1001", orderRef: null, affiliateId: "aff-1",
      occurredAt: "2026-09-05T12:00:00.000Z", currency: "USD", grossCents: 29_700, discountCents: 0,
      taxCents: 0, shippingCents: 0, refundedCents: 0, paymentStatus: "paid", paymentVerified: true,
      paymentVerifiedVia: "sellavi", isFoundersPack: false, correctedBy: null, ...partial,
    });
    expect(eligibleAmount(asTxn({ refundedCents: 10_000, paymentStatus: "partially_refunded" }), DEFAULT_POLICY).amountCents).toBe(19_700);
    expect(eligibleAmount(asTxn({ paymentStatus: "refunded" }), DEFAULT_POLICY).amountCents).toBe(0);
  });

  it("out-of-order (stale) source updates are ignored", async () => {
    const { db } = openTestDb();
    await seedAffiliate(db, "aff-1");
    await upsertTxn(db, srcTxn({ refundedCents: 29_700, paymentStatus: "refunded", sourceUpdatedAt: "2026-09-07T00:00:00.000Z" }));
    const res = await upsertTxn(db, srcTxn({ sourceUpdatedAt: "2026-09-05T00:00:00.000Z" })); // older snapshot
    expect(res).toBe("ignored_stale");
    const [row] = await ledgerRows(db);
    expect(row!.payment_status).toBe("refunded"); // newer state preserved
  });
});
