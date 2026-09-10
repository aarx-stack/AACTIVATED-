import type { Movement, RankedRow, SnapshotRow } from "./types";

export interface Entrant {
  affiliateId: string;
  displayName: string;
  amountCents: number;
  orders: number;
}

/**
 * Deterministic ranking: amount desc, then orders desc, then name — equal
 * inputs always produce identical boards on every client and the server.
 */
export function rank(entrants: Entrant[]): (RankedRow & { displayName: string })[] {
  const sorted = [...entrants].sort(
    (a, b) =>
      b.amountCents - a.amountCents ||
      b.orders - a.orders ||
      a.displayName.localeCompare(b.displayName),
  );
  return sorted.map((e, i) => ({
    rank: i + 1,
    affiliateId: e.affiliateId,
    displayName: e.displayName,
    amountCents: e.amountCents,
    orders: e.orders,
  }));
}

/**
 * Rank movement against the latest comparable snapshot for the same
 * (scope, period) — positive = climbed. Returns null when no snapshot
 * exists; callers must then show no movement at all rather than a guess.
 */
export function movement(
  current: RankedRow[],
  snapshot: SnapshotRow[] | null,
): Map<string, Movement> | null {
  if (snapshot === null) return null;
  const prev = new Map(snapshot.map((s) => [s.affiliateId, s.rank]));
  const out = new Map<string, Movement>();
  for (const row of current) {
    const p = prev.get(row.affiliateId);
    out.set(row.affiliateId, p === undefined ? "new" : p - row.rank);
  }
  return out;
}
