/**
 * Real-data snapshot mode: renders a point-in-time export of the live
 * Tapfiliate program through the exact same store/selectors as the demo —
 * same eligibility engine, same ranking, same status precedence. Read-only:
 * admin mutations stay disabled until the production Worker is deployed.
 */
import type { Affiliate, ChallengeConfig, TeamEdge, Txn } from "@shared/types";
import { DEFAULT_POLICY } from "@shared/types";
import type { DemoData } from "./fixtures";

export interface SnapshotAffiliate {
  id: string;
  displayName: string;
  enrolledAt: string;
  parentId: string | null;
}

export interface SnapshotConversion {
  id: string;
  externalId: string;
  orderRef: string;
  affiliateId: string;
  occurredAt: string;
  amountCents: number;
  excluded: boolean;
  excludedReason: string | null;
}

export interface SnapshotFile {
  version: 1;
  generatedAt: string;
  source: string;
  policyNote: string;
  affiliates: SnapshotAffiliate[];
  conversions: SnapshotConversion[];
  orphanConversionIds?: (string | number)[];
}

export function buildSnapshotData(file: SnapshotFile, nowMs = Date.now()): DemoData {
  const config: ChallengeConfig = {
    // Production truth: no launch date chosen → "Launch date pending".
    launchAt: null,
    launchIsDemoSample: false,
    windowDays: 30,
    directTargetCents: 1_000_000,
    teamTargetCents: 5_000_000,
    foundersPackMinCents: 250_000,
    seatCap: 50,
    policy: DEFAULT_POLICY,
    policyConfirmed: false,
  };

  const affiliates: Affiliate[] = file.affiliates.map((a) => ({
    id: a.id,
    tapfiliateId: a.id,
    displayName: a.displayName,
    displayNameApproved: true, // initials-derived names are publication-safe
    avatarUrl: null,
    status: "active",
    enrolledAt: a.enrolledAt,
  }));

  const edges: TeamEdge[] = file.affiliates
    .filter((a) => a.parentId)
    .map((a) => ({
      parentId: a.parentId!,
      childId: a.id,
      verified: true, // imported from the Tapfiliate MLM source
      source: "tapfiliate_mlm",
    }));

  const txnsByAffiliate = new Map<string, Txn[]>();
  for (const c of file.conversions) {
    const txn: Txn = {
      id: c.id,
      source: "tapfiliate",
      externalId: c.externalId,
      orderRef: c.orderRef,
      affiliateId: c.affiliateId,
      occurredAt: c.occurredAt,
      currency: "USD",
      grossCents: c.amountCents,
      discountCents: 0,
      taxCents: 0,
      shippingCents: 0,
      refundedCents: 0,
      // Snapshot policy (see file.policyNote): Sellavi-tracked checkouts
      // count as verified-paid; Tapfiliate-disapproved conversions do not.
      paymentStatus: c.excluded ? "unpaid" : "paid",
      paymentVerified: !c.excluded,
      paymentVerifiedVia: c.excluded ? null : "sellavi",
      isFoundersPack: false,
      correctedBy: null,
    };
    const list = txnsByAffiliate.get(txn.affiliateId) ?? [];
    list.push(txn);
    txnsByAffiliate.set(txn.affiliateId, list);
  }
  for (const list of txnsByAffiliate.values()) {
    list.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }

  const iso = new Date(file.generatedAt).toISOString();
  return {
    nowMs,
    config,
    affiliates,
    txnsByAffiliate,
    edges,
    memberships: [],
    extraMemberships: [],
    pending: [],
    // No history yet → movement stays hidden (the honest first-sync state).
    monthlySnapshotPersonal: [],
    monthlySnapshotTeam: [],
    reviewQueue: [],
    failedEvents: [],
    syncRuns: [
      {
        id: "snap-import",
        kind: "import",
        source: "tapfiliate",
        startedAt: iso,
        finishedAt: iso,
        ok: true,
        scanned: file.conversions.length + file.affiliates.length,
        updated: file.conversions.length,
        discrepancies: file.orphanConversionIds?.length ?? 0,
        note: `Snapshot via Claude Tapfiliate connector (${file.affiliates.length} affiliates, ${file.conversions.length} conversions)`,
      },
    ],
    auditLog: [
      {
        id: "au-snap-1",
        at: iso,
        actor: "owner session (Claude connector)",
        action: "snapshot.imported",
        entity: "dataset",
        entityId: "live-snapshot",
        reason: "Real-data snapshot generated from Tapfiliate; PII stripped; read-only preview.",
      },
    ],
    compPlanByAffiliate: new Map(),
    personas: [...file.affiliates]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((a) => ({ affiliateId: a.id, tagline: a.id })),
  };
}

/** Optional git-ignored snapshot file, when present in the build. */
export function loadSnapshotFile(): SnapshotFile | null {
  // Must stay a literal `import.meta.glob(...)` call — Vite resolves it at
  // build time; the glob keeps a missing (git-ignored) file from breaking
  // fresh-clone builds. Typed for the node test config in tests/types.d.ts.
  const files = import.meta.glob("./live-snapshot.json", { eager: true });
  const mod = Object.values(files)[0];
  if (!mod) return null;
  const data = (mod as { default?: unknown }).default ?? mod;
  return data as SnapshotFile;
}
