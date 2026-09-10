import type { SqlDb } from "../lib/db";

/**
 * Webhook delivery dedupe. One row per (source, delivery_key); a replayed
 * delivery no-ops on the primary key and reports `duplicate` so the caller
 * skips processing entirely.
 */
export async function recordDelivery(
  db: SqlDb,
  source: string,
  deliveryKey: string,
  payloadHash: string,
): Promise<"new" | "duplicate"> {
  const res = await db.run(
    `INSERT INTO webhook_events (source, delivery_key, payload_hash, status)
     VALUES (?1, ?2, ?3, 'received')
     ON CONFLICT (source, delivery_key) DO NOTHING`,
    source,
    deliveryKey,
    payloadHash,
  );
  return res.changes === 1 ? "new" : "duplicate";
}

export async function finishDelivery(
  db: SqlDb,
  source: string,
  deliveryKey: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  await db.run(
    `UPDATE webhook_events
     SET status = ?3, processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), error = ?4
     WHERE source = ?1 AND delivery_key = ?2`,
    source,
    deliveryKey,
    ok ? "processed" : "failed",
    error ?? null,
  );
}

export interface SourceTxn {
  id: string; // internal id used only on first insert
  source: "tapfiliate" | "sellavi" | "manual";
  externalId: string;
  orderRef: string | null;
  affiliateId: string;
  occurredAt: string;
  grossCents: number;
  discountCents: number;
  taxCents: number;
  shippingCents: number;
  refundedCents: number;
  paymentStatus: "paid" | "pending" | "unpaid" | "partially_refunded" | "refunded";
  paymentVerified: boolean;
  paymentVerifiedVia: "sellavi" | "admin" | null;
  isFoundersPack: boolean;
  /** Source-side updated_at; stale (older) updates are ignored. */
  sourceUpdatedAt: string | null;
}

export type UpsertResult = "inserted" | "updated" | "ignored_stale";

/**
 * Ledger upsert keyed by (source, external_id): re-imports, webhook replays,
 * refund updates and multiple commission records for one order all converge
 * on a single row — a transaction can never be counted twice. Out-of-order
 * source updates are dropped via the source_updated_at monotonic guard.
 */
export async function upsertTxn(db: SqlDb, t: SourceTxn): Promise<UpsertResult> {
  const existing = await db.first<{ id: string }>(
    "SELECT id FROM transactions WHERE source = ?1 AND external_id = ?2",
    t.source,
    t.externalId,
  );

  const res = await db.run(
    `INSERT INTO transactions (
       id, source, external_id, order_ref, affiliate_id, occurred_at,
       gross_cents, discount_cents, tax_cents, shipping_cents, refunded_cents,
       payment_status, payment_verified, payment_verified_via, is_founders_pack,
       source_updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
     ON CONFLICT (source, external_id) DO UPDATE SET
       order_ref = excluded.order_ref,
       affiliate_id = excluded.affiliate_id,
       occurred_at = excluded.occurred_at,
       gross_cents = excluded.gross_cents,
       discount_cents = excluded.discount_cents,
       tax_cents = excluded.tax_cents,
       shipping_cents = excluded.shipping_cents,
       refunded_cents = excluded.refunded_cents,
       payment_status = excluded.payment_status,
       payment_verified = excluded.payment_verified,
       payment_verified_via = excluded.payment_verified_via,
       is_founders_pack = excluded.is_founders_pack,
       source_updated_at = excluded.source_updated_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE COALESCE(excluded.source_updated_at, '9999') >= COALESCE(transactions.source_updated_at, '')`,
    t.id,
    t.source,
    t.externalId,
    t.orderRef,
    t.affiliateId,
    t.occurredAt,
    t.grossCents,
    t.discountCents,
    t.taxCents,
    t.shippingCents,
    t.refundedCents,
    t.paymentStatus,
    t.paymentVerified ? 1 : 0,
    t.paymentVerifiedVia,
    t.isFoundersPack ? 1 : 0,
    t.sourceUpdatedAt,
  );

  if (!existing) return "inserted";
  return res.changes === 1 ? "updated" : "ignored_stale";
}
