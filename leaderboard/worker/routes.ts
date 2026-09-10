import type { Env } from "./index";
import { Router } from "./lib/router";
import { HttpError, json, readJson, sha256Hex, timingSafeEqual } from "./lib/http";
import { d1Db, nowIso, uid } from "./lib/db";
import { authenticate, requireAdmin, requireAffiliate } from "./lib/auth";
import { challengeFor, leaderboard, loadConfig, recognition } from "./domain/queries";
import { claimSeat } from "./domain/seats";
import { finishDelivery, recordDelivery, upsertTxn } from "./domain/ingest";
import { membershipExpiry } from "@shared/challenge";
import { TapfiliateClient, conversionToTxn, type TapConversion } from "./adapters/tapfiliate";

export const router = new Router<Env>();

/* ————— public ————— */

router.get("/api/health", () => json({ ok: true, at: nowIso() }));

/* ————— authenticated (affiliate or admin) ————— */

router.get("/api/me", async ({ req, env }) => {
  const db = d1Db(env.DB);
  const id = await authenticate(req, env, db);
  const aff = id.affiliateId
    ? await db.first<{ id: string; display_name: string; status: string; enrolled_at: string }>(
        "SELECT id, display_name, status, enrolled_at FROM affiliates WHERE id = ?1",
        id.affiliateId,
      )
    : null;
  // Own record only — and only the fields the dashboard needs.
  return json({
    role: id.role,
    affiliate: aff
      ? { id: aff.id, displayName: aff.display_name, status: aff.status, enrolledAt: aff.enrolled_at }
      : null,
  });
});

router.get("/api/status", async ({ req, env }) => {
  const db = d1Db(env.DB);
  await authenticate(req, env, db);
  const last = await db.first<{ finished_at: string | null }>(
    "SELECT finished_at FROM sync_runs WHERE ok = 1 ORDER BY started_at DESC LIMIT 1",
  );
  const lastFailed = await db.first<{ started_at: string }>(
    "SELECT started_at FROM sync_runs WHERE ok = 0 ORDER BY started_at DESC LIMIT 1",
  );
  // Honest status only: real last-success time; "degraded" when the most
  // recent run failed. Never a synthetic "live".
  const degraded =
    lastFailed && (!last?.finished_at || Date.parse(lastFailed.started_at) > Date.parse(last.finished_at));
  return json({ lastSuccessfulSyncAt: last?.finished_at ?? null, health: degraded ? "degraded" : "ok" });
});

router.get("/api/leaderboard", async ({ req, env, url }) => {
  const db = d1Db(env.DB);
  await authenticate(req, env, db); // any signed-in program member may view boards
  const scope = url.searchParams.get("scope") === "team" ? "team" : "personal";
  const p = url.searchParams.get("period");
  const period = p === "weekly" ? "weekly" : p === "alltime" ? "alltime" : "monthly";
  const board = await leaderboard(db, scope, period, Date.now());
  return json(board);
});

router.get("/api/challenge", async ({ req, env }) => {
  const db = d1Db(env.DB);
  const id = await authenticate(req, env, db);
  const affiliateId = requireAffiliate(id);
  const ch = await challengeFor(db, affiliateId, Date.now());
  if (!ch) throw new HttpError(404, "affiliate_not_found");
  return json(ch);
});

router.get("/api/recognition", async ({ req, env }) => {
  const db = d1Db(env.DB);
  await authenticate(req, env, db);
  return json({ members: await recognition(db, Date.now()) });
});

/* ————— admin ————— */

async function adminCtx(req: Request, env: Env) {
  const db = d1Db(env.DB);
  const id = await authenticate(req, env, db);
  requireAdmin(id);
  return { db, id };
}

async function audit(
  db: ReturnType<typeof d1Db>,
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  reason: string,
) {
  await db.run(
    "INSERT INTO audit_log (id, actor, action, entity, entity_id, reason) VALUES (?1,?2,?3,?4,?5,?6)",
    uid(),
    actor,
    action,
    entity,
    entityId,
    reason,
  );
}

function requireReason(body: { reason?: string }): string {
  const r = body.reason?.trim() ?? "";
  if (r.length < 8) throw new HttpError(400, "reason_required", "A reason of at least 8 characters is required");
  return r;
}

router.get("/api/admin/queue", async ({ req, env }) => {
  const { db } = await adminCtx(req, env);
  const rows = await db.all(
    `SELECT q.*, a.display_name FROM review_queue q
     JOIN affiliates a ON a.id = q.affiliate_id
     WHERE q.status = 'pending' ORDER BY q.submitted_at`,
  );
  return json({ items: rows });
});

router.post("/api/admin/queue/:id/approve", async ({ req, env, params }) => {
  const { db, id } = await adminCtx(req, env);
  const reason = requireReason(await readJson<{ reason?: string }>(req));
  const item = await db.first<{
    id: string; kind: string; affiliate_id: string; txn_id: string | null;
  }>("SELECT * FROM review_queue WHERE id = ?1 AND status = 'pending'", params.id!);
  if (!item) throw new HttpError(404, "not_found");

  const actor = id.email ?? id.subject;

  if (item.kind === "refund_review") {
    await db.run(
      `UPDATE review_queue SET status='approved', decided_at=?2, decided_by=?3, decision_reason=?4 WHERE id=?1`,
      item.id, nowIso(), actor, reason,
    );
    await audit(db, actor, "refund_review.resolved", "review", item.id, reason);
    return json({ ok: true, outcome: "resolved" });
  }

  // Founders-pack approval = admin payment verification + atomic seat claim.
  if (item.txn_id) {
    await db.run(
      `UPDATE transactions SET payment_status='paid', payment_verified=1, payment_verified_via='admin',
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`,
      item.txn_id,
    );
  }
  const cfg = await loadConfig(db);
  const txn = item.txn_id
    ? await db.first<{ occurred_at: string }>("SELECT occurred_at FROM transactions WHERE id = ?1", item.txn_id)
    : null;
  const verifiedAt = nowIso();
  const claim = await claimSeat(db, {
    affiliateId: item.affiliate_id,
    path: "founders_pack",
    qualifiedAt: txn?.occurred_at ?? verifiedAt,
    verifiedAt,
    membershipExpiresAt: new Date(membershipExpiry(Date.parse(verifiedAt))).toISOString(),
    seatCap: cfg.seatCap,
  });
  await db.run(
    `UPDATE review_queue SET status='approved', decided_at=?2, decided_by=?3, decision_reason=?4 WHERE id=?1`,
    item.id, nowIso(), actor, reason,
  );
  await audit(db, actor, `founders_pack.approved.${claim.result}`, "affiliate", item.affiliate_id, reason);
  return json({ ok: claim.result !== "capacity", outcome: claim.result, seatNo: claim.seatNo });
});

router.post("/api/admin/queue/:id/reject", async ({ req, env, params }) => {
  const { db, id } = await adminCtx(req, env);
  const reason = requireReason(await readJson<{ reason?: string }>(req));
  const res = await db.run(
    `UPDATE review_queue SET status='rejected', decided_at=?2, decided_by=?3, decision_reason=?4
     WHERE id = ?1 AND status = 'pending'`,
    params.id!, nowIso(), id.email ?? id.subject, reason,
  );
  if (res.changes === 0) throw new HttpError(404, "not_found");
  await audit(db, id.email ?? id.subject, "review.rejected", "review", params.id!, reason);
  return json({ ok: true });
});

router.post("/api/admin/corrections", async ({ req, env }) => {
  const { db, id } = await adminCtx(req, env);
  const body = await readJson<{
    txnId?: string;
    change?: { paymentStatus?: string; paymentVerified?: boolean; refundedCents?: number };
    reason?: string;
  }>(req);
  const reason = requireReason(body);
  if (!body.txnId || !body.change) throw new HttpError(400, "bad_request");
  const txn = await db.first<{ id: string; external_id: string }>(
    "SELECT id, external_id FROM transactions WHERE id = ?1 OR external_id = ?1",
    body.txnId,
  );
  if (!txn) throw new HttpError(404, "txn_not_found");

  const sets: string[] = [];
  const vals: unknown[] = [];
  const allowedStatus = ["paid", "pending", "unpaid", "partially_refunded", "refunded"];
  if (body.change.paymentStatus !== undefined) {
    if (!allowedStatus.includes(body.change.paymentStatus)) throw new HttpError(400, "bad_status");
    sets.push(`payment_status = ?${vals.length + 2}`);
    vals.push(body.change.paymentStatus);
  }
  if (body.change.paymentVerified !== undefined) {
    sets.push(`payment_verified = ?${vals.length + 2}`);
    vals.push(body.change.paymentVerified ? 1 : 0);
    sets.push(`payment_verified_via = ${body.change.paymentVerified ? "'admin'" : "NULL"}`);
  }
  if (body.change.refundedCents !== undefined) {
    if (!Number.isInteger(body.change.refundedCents) || body.change.refundedCents < 0)
      throw new HttpError(400, "bad_refund");
    sets.push(`refunded_cents = ?${vals.length + 2}`);
    vals.push(body.change.refundedCents);
  }
  if (sets.length === 0) throw new HttpError(400, "no_change");
  sets.push(`corrected_by = ?${vals.length + 2}`);
  vals.push(id.email ?? id.subject);
  await db.run(
    `UPDATE transactions SET ${sets.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`,
    txn.id,
    ...vals,
  );
  await audit(db, id.email ?? id.subject, "correction.applied", "txn", txn.external_id, reason);
  return json({ ok: true });
});

router.put("/api/admin/config/launch", async ({ req, env }) => {
  const { db, id } = await adminCtx(req, env);
  const body = await readJson<{ launchAt?: string | null; reason?: string }>(req);
  const reason = requireReason(body);
  const launchAt = body.launchAt ?? null;
  if (launchAt !== null && Number.isNaN(Date.parse(launchAt))) throw new HttpError(400, "bad_date");
  await db.run(
    `UPDATE challenge_config SET launch_at = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ?2 WHERE id = 1`,
    launchAt,
    id.email ?? id.subject,
  );
  await audit(db, id.email ?? id.subject, "challenge.launch_date.set", "challenge_config", "1", reason);
  return json({ ok: true, launchAt });
});

router.get("/api/admin/export/:kind", async ({ req, env, params }) => {
  const { db } = await adminCtx(req, env);
  // Permitted fields only — never customer details or credentials.
  if (params.kind === "affiliates") {
    const rows = await db.all<Record<string, unknown>>(
      `SELECT a.id, a.display_name, a.status, a.enrolled_at, m.seat_no, m.membership_expires_at
       FROM affiliates a LEFT JOIN memberships m ON m.affiliate_id = a.id ORDER BY a.display_name`,
    );
    const header = "affiliate_id,display_name,status,enrolled_at_utc,seat_no,membership_expires_utc";
    const csv = [header, ...rows.map((r) =>
      [r.id, JSON.stringify(r.display_name ?? ""), r.status, r.enrolled_at, r.seat_no ?? "", r.membership_expires_at ?? ""].join(","),
    )].join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="aactivated-affiliates.csv"',
      },
    });
  }
  throw new HttpError(404, "unknown_export");
});

/* ————— webhooks ————— */

router.post("/api/webhooks/tapfiliate/:secret", async ({ req, env, params }) => {
  // URL-secret gate (fail closed when unset). Payloads are hints only: the
  // referenced record is re-fetched from the authenticated REST API before
  // any write — no invented signature headers, nothing trusted blind.
  if (!env.TAPFILIATE_WEBHOOK_SECRET) throw new HttpError(503, "webhook_not_configured");
  if (!timingSafeEqual(params.secret!, env.TAPFILIATE_WEBHOOK_SECRET)) throw new HttpError(404, "not_found");

  const db = d1Db(env.DB);
  const raw = await req.text();
  const payloadHash = await sha256Hex(raw);

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_json");
  }
  const conversionId =
    (body["conversion_id"] as string | number | undefined) ??
    ((body["conversion"] as Record<string, unknown> | undefined)?.["id"] as string | number | undefined) ??
    (body["id"] as string | number | undefined);

  const deliveryKey = String((body["event_id"] as string | undefined) ?? payloadHash);
  if ((await recordDelivery(db, "tapfiliate", deliveryKey, payloadHash)) === "duplicate") {
    return json({ ok: true, deduplicated: true });
  }

  if (!env.TAPFILIATE_API_KEY) {
    await finishDelivery(db, "tapfiliate", deliveryKey, false, "TAPFILIATE_API_KEY not configured");
    return json({ ok: false, stored: true, error: "api_key_missing" }, 202);
  }
  if (conversionId === undefined) {
    await finishDelivery(db, "tapfiliate", deliveryKey, false, "no conversion id in payload");
    return json({ ok: false, stored: true, error: "no_conversion_id" }, 202);
  }

  try {
    const client = new TapfiliateClient({ apiKey: env.TAPFILIATE_API_KEY });
    const conv: TapConversion = await client.getConversion(conversionId);
    const tapAffiliateId = conv.affiliate?.id ?? conv.affiliate_id ?? null;
    const aff = tapAffiliateId
      ? await db.first<{ id: string }>("SELECT id FROM affiliates WHERE tapfiliate_id = ?1", String(tapAffiliateId))
      : null;
    if (!aff) throw new Error(`unknown affiliate for conversion ${conversionId}`);
    const txn = conversionToTxn(conv, aff.id);
    if (!txn) throw new Error("conversion missing amount");
    const result = await upsertTxn(db, txn);
    await finishDelivery(db, "tapfiliate", deliveryKey, true);
    await db.run(
      `INSERT INTO sync_runs (id, kind, source, started_at, finished_at, ok, scanned, updated, note)
       VALUES (?1,'webhook','tapfiliate',?2,?2,1,1,?3,?4)`,
      uid(), nowIso(), result === "ignored_stale" ? 0 : 1, `conversion ${conversionId} ${result}`,
    );
    return json({ ok: true, result });
  } catch (e) {
    await finishDelivery(db, "tapfiliate", deliveryKey, false, e instanceof Error ? e.message : "error");
    // 200-range so the source doesn't retry forever; reconciliation replays it.
    return json({ ok: false, stored: true }, 202);
  }
});

router.post("/api/webhooks/sellavi/:secret", () => {
  // No confirmed Sellavi webhook contract yet — refuse loudly rather than
  // pretend. Payment verification stays in manual/admin mode until then.
  throw new HttpError(501, "sellavi_not_configured", "Sellavi integration is not confirmed/configured");
});
