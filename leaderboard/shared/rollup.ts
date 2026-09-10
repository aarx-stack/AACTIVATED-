import type { RollupPolicy, TeamEdge } from "./types";

export interface TeamRollup {
  /** Team totals for affiliates whose team data is connected. */
  amounts: Map<string, number>;
  orders: Map<string, number>;
  /** Affiliates whose team data is NOT connected (unverified relationships). */
  disconnected: Set<string>;
}

/**
 * Team totals from verified parent→child relationships ONLY. Commission
 * records never enter this computation — inputs are per-affiliate PERSONAL
 * eligible totals, so an order can contribute at most once to any ancestor's
 * team figure regardless of how many commission rows the source created.
 *
 * An affiliate whose subtree touches any unverified edge is reported as
 * `disconnected` ("Team data not connected") rather than shown a number we
 * cannot stand behind.
 */
export function teamRollup(
  affiliateIds: Iterable<string>,
  edges: TeamEdge[],
  personalAmounts: Map<string, number>,
  personalOrders: Map<string, number>,
  policy: RollupPolicy,
): TeamRollup {
  const verifiedChildren = new Map<string, string[]>();
  const unverifiedParents = new Set<string>();
  const seenChild = new Set<string>();

  for (const e of edges) {
    if (!e.verified) {
      unverifiedParents.add(e.parentId);
      continue;
    }
    // A child may have at most one verified parent; ignore duplicates defensively.
    if (seenChild.has(e.childId)) continue;
    seenChild.add(e.childId);
    const list = verifiedChildren.get(e.parentId) ?? [];
    list.push(e.childId);
    verifiedChildren.set(e.parentId, list);
  }

  const amounts = new Map<string, number>();
  const orders = new Map<string, number>();
  const disconnected = new Set<string>();

  const collectDescendants = (root: string): Set<string> | null => {
    const found = new Set<string>();
    const stack = [...(verifiedChildren.get(root) ?? [])];
    let sawUnverified = unverifiedParents.has(root);
    while (stack.length) {
      const id = stack.pop()!;
      if (found.has(id) || id === root) continue; // cycle-safe
      found.add(id);
      if (unverifiedParents.has(id)) sawUnverified = true;
      for (const c of verifiedChildren.get(id) ?? []) stack.push(c);
    }
    return sawUnverified ? null : found;
  };

  for (const id of affiliateIds) {
    const descendants = collectDescendants(id);
    if (descendants === null) {
      disconnected.add(id);
      continue;
    }
    let amount = 0;
    let count = 0;
    if (policy === "self_plus_descendants") {
      amount += personalAmounts.get(id) ?? 0;
      count += personalOrders.get(id) ?? 0;
    }
    for (const d of descendants) {
      amount += personalAmounts.get(d) ?? 0;
      count += personalOrders.get(d) ?? 0;
    }
    amounts.set(id, amount);
    orders.set(id, count);
  }

  return { amounts, orders, disconnected };
}
