import type { Env } from "../index";
import { d1Db, nowIso, uid } from "../lib/db";
import { upsertTxn } from "../domain/ingest";
import { leaderboard } from "../domain/queries";
import { importAffiliates } from "./import";
import { TapfiliateClient, conversionToTxn } from "../adapters/tapfiliate";
import { periodRange } from "@shared/time";

/**
 * Scheduled reconciliation: refresh affiliates + hierarchy, then pull
 * conversions from the source of truth and re-upsert them, recovering
 * anything a missed/failed webhook dropped. Every run is recorded honestly in
 * sync_runs — the dashboard's "last successful update" comes from there and
 * nowhere else.
 *
 * `full` (used for the one-time backfill) pulls all history instead of the
 * rolling look-back window.
 */
export async function reconcile(env: Env, opts: { full?: boolean } = {}): Promise<void> {
  const db = d1Db(env.DB);
  const runId = uid();
  const startedAt = nowIso();

  if (!env.TAPFILIATE_API_KEY) {
    await db.run(
      `INSERT INTO sync_runs (id, kind, source, started_at, finished_at, ok, note)
       VALUES (?1,'reconcile','tapfiliate',?2,?2,0,'skipped: TAPFILIATE_API_KEY not configured')`,
      runId, startedAt,
    );
    return;
  }

  let scanned = 0;
  let updated = 0;
  let discrepancies = 0;
  let importedAffiliates = 0;
  try {
    const client = new TapfiliateClient({ apiKey: env.TAPFILIATE_API_KEY });

    // Keep affiliates + team hierarchy current before counting conversions
    // (a conversion for an unknown affiliate would otherwise be a discrepancy).
    const imported = await importAffiliates(db, client);
    importedAffiliates = imported.affiliates;

    // Backfill pulls everything; steady-state looks back 7 days for late edits.
    const since = opts.full ? undefined : new Date(Date.now() - 7 * 86_400_000).toISOString();
    const tapIds = new Map<string, string>(); // tapfiliate_id -> affiliate id
    for (const row of await db.all<{ id: string; tapfiliate_id: string | null }>(
      "SELECT id, tapfiliate_id FROM affiliates WHERE tapfiliate_id IS NOT NULL",
    )) {
      tapIds.set(row.tapfiliate_id!, row.id);
    }
    for await (const pageRows of client.listConversions(since)) {
      for (const conv of pageRows) {
        scanned++;
        const tapAffId = conv.affiliate?.id ?? conv.affiliate_id;
        const affiliateId = tapAffId ? tapIds.get(String(tapAffId)) : undefined;
        if (!affiliateId) {
          discrepancies++;
          continue;
        }
        const txn = conversionToTxn(conv, affiliateId);
        if (!txn) {
          discrepancies++;
          continue;
        }
        const res = await upsertTxn(db, txn);
        if (res !== "ignored_stale") updated++;
      }
    }
    await db.run(
      `INSERT INTO sync_runs (id, kind, source, started_at, finished_at, ok, scanned, updated, discrepancies, note)
       VALUES (?1,'reconcile','tapfiliate',?2,?3,1,?4,?5,?6,?7)`,
      runId, startedAt, nowIso(), scanned, updated, discrepancies,
      `${opts.full ? "backfill" : "ok"}: ${importedAffiliates} affiliates`,
    );
  } catch (e) {
    await db.run(
      `INSERT INTO sync_runs (id, kind, source, started_at, finished_at, ok, scanned, updated, discrepancies, note)
       VALUES (?1,'reconcile','tapfiliate',?2,?3,0,?4,?5,?6,?7)`,
      runId, startedAt, nowIso(), scanned, updated, discrepancies,
      e instanceof Error ? e.message : "error",
    );
  }
}

/**
 * Daily snapshot job: freezes today's ranks per (period, scope) so the UI can
 * show rank movement. Movement is only ever shown when one of these exists.
 */
export async function snapshotLeaderboards(env: Env): Promise<void> {
  const db = d1Db(env.DB);
  const nowMs = Date.now();
  const takenAt = nowIso();
  for (const period of ["monthly", "weekly"] as const) {
    const range = periodRange(period, nowMs);
    for (const scope of ["personal", "team"] as const) {
      const board = await leaderboard(db, scope, period, nowMs);
      for (const row of board.rows) {
        await db.run(
          `INSERT INTO leaderboard_snapshots (period_type, period_key, scope, taken_at, affiliate_id, rank, amount_cents)
           VALUES (?1,?2,?3,?4,?5,?6,?7)
           ON CONFLICT (period_type, period_key, scope, affiliate_id)
           DO UPDATE SET taken_at = excluded.taken_at, rank = excluded.rank, amount_cents = excluded.amount_cents`,
          period, range.key, scope, takenAt, row.affiliateId, row.rank, row.amountCents,
        );
      }
    }
  }
  await db.run(
    `INSERT INTO sync_runs (id, kind, source, started_at, finished_at, ok, note)
     VALUES (?1,'snapshot','internal',?2,?2,1,'daily leaderboard snapshot')`,
    uid(), takenAt,
  );
}
