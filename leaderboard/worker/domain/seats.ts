import type { SqlDb } from "../lib/db";

export type ClaimResult = "claimed" | "already_member" | "capacity";

/**
 * Atomic seat claim. A single guarded INSERT: SQLite (and therefore D1)
 * executes it under the database write lock, so the COUNT guard, the seat
 * number, and the row insert are one indivisible step — two concurrent
 * claims for the last seat can never both succeed. UNIQUE(affiliate_id) and
 * seat_no PRIMARY KEY back this up structurally.
 *
 * Seat priority = verification-completion order (callers pass verifiedAt at
 * the moment verification completes). NOTE: pending owner confirmation — see
 * docs/DECISIONS_NEEDED.md before production activation.
 */
export async function claimSeat(
  db: SqlDb,
  args: {
    affiliateId: string;
    path: "direct" | "team" | "founders_pack";
    qualifiedAt: string;
    verifiedAt: string;
    membershipExpiresAt: string;
    seatCap: number;
  },
): Promise<{ result: ClaimResult; seatNo: number | null }> {
  const res = await db.run(
    `INSERT INTO memberships (seat_no, affiliate_id, path, qualified_at, verified_at, membership_expires_at)
     SELECT (SELECT COUNT(*) FROM memberships) + 1, ?1, ?2, ?3, ?4, ?5
     WHERE (SELECT COUNT(*) FROM memberships) < ?6
       AND NOT EXISTS (SELECT 1 FROM memberships WHERE affiliate_id = ?1)`,
    args.affiliateId,
    args.path,
    args.qualifiedAt,
    args.verifiedAt,
    args.membershipExpiresAt,
    args.seatCap,
  );

  if (res.changes === 1) {
    const row = await db.first<{ seat_no: number }>(
      "SELECT seat_no FROM memberships WHERE affiliate_id = ?1",
      args.affiliateId,
    );
    return { result: "claimed", seatNo: row?.seat_no ?? null };
  }

  const existing = await db.first<{ seat_no: number }>(
    "SELECT seat_no FROM memberships WHERE affiliate_id = ?1",
    args.affiliateId,
  );
  if (existing) return { result: "already_member", seatNo: existing.seat_no };
  return { result: "capacity", seatNo: null };
}

export async function seatsClaimed(db: SqlDb): Promise<number> {
  const row = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM memberships");
  return row?.n ?? 0;
}
