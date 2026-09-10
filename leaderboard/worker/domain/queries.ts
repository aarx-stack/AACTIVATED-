/**
 * Read-side queries: raw rows come from D1, but every eligibility/ranking/
 * status decision funnels through the shared, unit-tested domain modules —
 * the same code the demo runs — so demo and production can never disagree
 * on the rules.
 *
 * Scale note: period queries load the period's transactions and compute in
 * the Worker. That is comfortably fine at this program's scale; if all-time
 * volume grows large, add a materialized aggregates table refreshed by the
 * reconcile cron — the shared functions stay the single source of truth.
 */
import type { SqlDb } from "../lib/db";
import type {
  ChallengeConfig,
  Membership,
  PendingVerification,
  PeriodType,
  Scope,
  SnapshotRow,
  TeamEdge,
  Txn,
} from "@shared/types";
import { totalsInRange } from "@shared/eligibility";
import { challengeStatus, challengeWindow, foundersPackProgress } from "@shared/challenge";
import { rank, movement, type Entrant } from "@shared/leaderboard";
import { teamRollup } from "@shared/rollup";
import { periodRange } from "@shared/time";

interface TxnRow {
  id: string;
  source: string;
  external_id: string;
  order_ref: string | null;
  affiliate_id: string;
  occurred_at: string;
  gross_cents: number;
  discount_cents: number;
  tax_cents: number;
  shipping_cents: number;
  refunded_cents: number;
  payment_status: Txn["paymentStatus"];
  payment_verified: number;
  payment_verified_via: "sellavi" | "admin" | null;
  is_founders_pack: number;
  corrected_by: string | null;
}

const toTxn = (r: TxnRow): Txn => ({
  id: r.id,
  source: r.source as Txn["source"],
  externalId: r.external_id,
  orderRef: r.order_ref,
  affiliateId: r.affiliate_id,
  occurredAt: r.occurred_at,
  currency: "USD",
  grossCents: r.gross_cents,
  discountCents: r.discount_cents,
  taxCents: r.tax_cents,
  shippingCents: r.shipping_cents,
  refundedCents: r.refunded_cents,
  paymentStatus: r.payment_status,
  paymentVerified: r.payment_verified === 1,
  paymentVerifiedVia: r.payment_verified_via,
  isFoundersPack: r.is_founders_pack === 1,
  correctedBy: r.corrected_by,
});

export async function loadConfig(db: SqlDb): Promise<ChallengeConfig> {
  const row = await db.first<{
    launch_at: string | null;
    window_days: number;
    direct_target_cents: number;
    team_target_cents: number;
    founders_pack_min_cents: number;
    seat_cap: number;
    policy_json: string;
    policy_confirmed: number;
  }>("SELECT * FROM challenge_config WHERE id = 1");
  if (!row) throw new Error("challenge_config missing");
  return {
    launchAt: row.launch_at,
    launchIsDemoSample: false,
    windowDays: row.window_days,
    directTargetCents: row.direct_target_cents,
    teamTargetCents: row.team_target_cents,
    foundersPackMinCents: row.founders_pack_min_cents,
    seatCap: row.seat_cap,
    policy: JSON.parse(row.policy_json),
    policyConfirmed: row.policy_confirmed === 1,
  };
}

async function txnsInRange(
  db: SqlDb,
  range: { startMs: number; endMs: number | null },
): Promise<Map<string, Txn[]>> {
  const rows =
    range.endMs === null
      ? await db.all<TxnRow>(
          "SELECT * FROM transactions WHERE occurred_at >= ?1",
          new Date(range.startMs).toISOString(),
        )
      : await db.all<TxnRow>(
          "SELECT * FROM transactions WHERE occurred_at >= ?1 AND occurred_at < ?2",
          new Date(range.startMs).toISOString(),
          new Date(range.endMs).toISOString(),
        );
  const map = new Map<string, Txn[]>();
  for (const r of rows) {
    const t = toTxn(r);
    const list = map.get(t.affiliateId) ?? [];
    list.push(t);
    map.set(t.affiliateId, list);
  }
  return map;
}

export interface BoardRowDto {
  rank: number;
  affiliateId: string;
  displayName: string;
  amountCents: number;
  orders: number;
  movement: number | "new" | null;
}

/** Leaderboard DTO — only permitted public fields ever leave this function. */
export async function leaderboard(
  db: SqlDb,
  scope: Scope,
  period: PeriodType,
  nowMs: number,
): Promise<{ rows: BoardRowDto[]; hasSnapshot: boolean; disconnectedCount: number }> {
  const cfg = await loadConfig(db);
  const range = periodRange(period, nowMs);
  const affs = await db.all<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM affiliates WHERE status = 'active' AND display_name_approved = 1",
  );
  const txns = await txnsInRange(db, range);

  let entrants: Entrant[] = [];
  let disconnectedCount = 0;

  if (scope === "personal") {
    entrants = affs.map((a) => {
      const t = totalsInRange(txns.get(a.id) ?? [], cfg.policy, range);
      return { affiliateId: a.id, displayName: a.display_name, amountCents: t.amountCents, orders: t.orders };
    });
  } else {
    const edgeRows = await db.all<{ parent_id: string; child_id: string; verified: number; source: string }>(
      "SELECT parent_id, child_id, verified, source FROM team_edges",
    );
    const edges: TeamEdge[] = edgeRows.map((e) => ({
      parentId: e.parent_id,
      childId: e.child_id,
      verified: e.verified === 1,
      source: e.source as TeamEdge["source"],
    }));
    const amounts = new Map<string, number>();
    const orders = new Map<string, number>();
    for (const a of affs) {
      const t = totalsInRange(txns.get(a.id) ?? [], cfg.policy, range);
      amounts.set(a.id, t.amountCents);
      orders.set(a.id, t.orders);
    }
    // SAMPLE rollup policy — pending owner confirmation (docs/DECISIONS_NEEDED.md).
    const rollup = teamRollup(affs.map((a) => a.id), edges, amounts, orders, "self_plus_descendants");
    const nameOf = new Map(affs.map((a) => [a.id, a.display_name]));
    disconnectedCount = rollup.disconnected.size;
    entrants = [...rollup.amounts.entries()]
      .filter(([id]) => !rollup.disconnected.has(id))
      .map(([id, amountCents]) => ({
        affiliateId: id,
        displayName: nameOf.get(id) ?? "—",
        amountCents,
        orders: rollup.orders.get(id) ?? 0,
      }));
  }

  const ranked = rank(entrants);
  const snapRows = await db.all<{ affiliate_id: string; rank: number }>(
    `SELECT affiliate_id, rank FROM leaderboard_snapshots
     WHERE period_type = ?1 AND period_key = ?2 AND scope = ?3`,
    range.type,
    range.key,
    scope,
  );
  const snapshot: SnapshotRow[] | null =
    period === "alltime" || snapRows.length === 0
      ? null
      : snapRows.map((s) => ({ affiliateId: s.affiliate_id, rank: s.rank }));
  const moves = movement(ranked, snapshot);

  return {
    rows: ranked.map((r) => ({
      rank: r.rank,
      affiliateId: r.affiliateId,
      displayName: r.displayName,
      amountCents: r.amountCents,
      orders: r.orders,
      movement: moves?.get(r.affiliateId) ?? null,
    })),
    hasSnapshot: moves !== null,
    disconnectedCount,
  };
}

export async function challengeFor(db: SqlDb, affiliateId: string, nowMs: number) {
  const cfg = await loadConfig(db);
  const aff = await db.first<{ enrolled_at: string }>(
    "SELECT enrolled_at FROM affiliates WHERE id = ?1",
    affiliateId,
  );
  if (!aff) return null;

  const win = challengeWindow(
    Date.parse(aff.enrolled_at),
    cfg.launchAt ? Date.parse(cfg.launchAt) : null,
    cfg.windowDays,
  );

  const myTxnRows = await db.all<TxnRow>(
    "SELECT * FROM transactions WHERE affiliate_id = ?1",
    affiliateId,
  );
  const myTxns = myTxnRows.map(toTxn);
  const winRange = win ? { startMs: win.startMs, endMs: win.endMs } : null;
  const directCents = winRange ? totalsInRange(myTxns, cfg.policy, winRange).amountCents : 0;

  // Team-in-window (sample rollup policy; disconnected → null).
  let teamCents: number | null = null;
  const edgeRows = await db.all<{ parent_id: string; child_id: string; verified: number; source: string }>(
    "SELECT parent_id, child_id, verified, source FROM team_edges",
  );
  const edges: TeamEdge[] = edgeRows.map((e) => ({
    parentId: e.parent_id,
    childId: e.child_id,
    verified: e.verified === 1,
    source: e.source as TeamEdge["source"],
  }));
  if (winRange) {
    const winTxns = await txnsInRange(db, winRange);
    const amounts = new Map<string, number>();
    for (const [id, list] of winTxns) amounts.set(id, totalsInRange(list, cfg.policy, winRange).amountCents);
    const rollup = teamRollup([affiliateId], edges, amounts, new Map(), "self_plus_descendants");
    teamCents = rollup.disconnected.has(affiliateId) ? null : (rollup.amounts.get(affiliateId) ?? 0);
  } else if (edges.some((e) => !e.verified && e.parentId === affiliateId)) {
    teamCents = null;
  } else {
    teamCents = 0;
  }

  const memRow = await db.first<{
    seat_no: number; path: Membership["path"]; qualified_at: string; verified_at: string; membership_expires_at: string;
  }>("SELECT * FROM memberships WHERE affiliate_id = ?1", affiliateId);
  const membership: Membership | null = memRow
    ? {
        affiliateId,
        seatNo: memRow.seat_no,
        path: memRow.path,
        qualifiedAt: memRow.qualified_at,
        verifiedAt: memRow.verified_at,
        membershipExpiresAt: memRow.membership_expires_at,
      }
    : null;

  const pendRow = await db.first<{ kind: string; submitted_at: string; txn_id: string | null }>(
    `SELECT kind, submitted_at, txn_id FROM review_queue
     WHERE affiliate_id = ?1 AND status = 'pending' AND kind IN ('founders_pack','path_completion')
     ORDER BY submitted_at LIMIT 1`,
    affiliateId,
  );
  const pending: PendingVerification | null = pendRow
    ? {
        affiliateId,
        path: pendRow.kind === "founders_pack" ? "founders_pack" : "direct",
        submittedAt: pendRow.submitted_at,
        txnId: pendRow.txn_id,
      }
    : null;

  const seats = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM memberships");

  const progress = {
    directCents,
    teamCents,
    foundersPack: foundersPackProgress(myTxns, cfg, win),
  };
  const status = challengeStatus(
    {
      nowMs,
      window: win,
      membership,
      pending,
      seatsClaimed: seats?.n ?? 0,
      seatCap: cfg.seatCap,
      progress,
    },
    cfg,
  );

  return {
    status: status.state,
    window: win,
    progress,
    membership,
    seatsClaimed: seats?.n ?? 0,
    seatCap: cfg.seatCap,
    launchPending: cfg.launchAt === null,
  };
}

export async function recognition(db: SqlDb, nowMs: number) {
  const rows = await db.all<{
    seat_no: number; qualified_at: string; membership_expires_at: string; display_name: string;
  }>(
    `SELECT m.seat_no, m.qualified_at, m.membership_expires_at, a.display_name
     FROM memberships m JOIN affiliates a ON a.id = m.affiliate_id
     WHERE a.display_name_approved = 1
     ORDER BY m.seat_no`,
  );
  // Privacy: names, seat and dates only — never amounts, paths or purchases.
  return rows.map((r) => ({
    displayName: r.display_name,
    seatNo: r.seat_no,
    qualifiedAt: r.qualified_at,
    expired: nowMs >= Date.parse(r.membership_expires_at),
  }));
}
