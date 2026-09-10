/**
 * Real-data snapshot pipeline: raw Tapfiliate pulls → PII-stripped snapshot
 * file → the same store/selectors the demo uses. Fixture shapes mirror the
 * live API (fields verified against the real account); names are synthetic.
 */
import { describe, expect, it } from "vitest";
import { deriveDisplayName, transform } from "../scripts/build-snapshot.mjs";
import { buildSnapshotData } from "../src/data/snapshot";
import { DemoStore } from "../src/data/store";

const rawAffiliates = [
  {
    id: "leaderlee1",
    firstname: "lee",
    lastname: "vanguard",
    created_at: "2026-09-01T10:00:00+00:00",
    parent_id: null,
    email: "lee@example.test",
    address: { city: "Testville" },
    custom_fields: { "phone-number": "555-0100" },
  },
  {
    id: "kidkara2",
    firstname: "Kara",
    lastname: "Del Sol",
    created_at: "2026-09-02T10:00:00+00:00",
    parent_id: "leaderlee1",
    email: "kara@example.test",
  },
  {
    id: "kidkonnor3",
    firstname: "Konnor",
    lastname: "Quill",
    created_at: "2026-09-03T10:00:00+00:00",
    parent_id: "kidkara2",
    email: "konnor@example.test",
  },
];

const rawConversions = [
  {
    id: 900001,
    created_at: "2026-09-05T12:00:00+00:00",
    amount: 99.97,
    external_id: "SELLAVI-SELLAVI-7001",
    affiliate: { id: "kidkara2" },
    commissions: [
      { kind: "regular", approved: null },
      { kind: "level", approved: null },
    ],
  },
  {
    id: 900002,
    created_at: "2026-09-06T12:00:00+00:00",
    amount: 64.98,
    external_id: "SELLAVI-7002",
    affiliate: { id: "kidkonnor3" },
    commissions: [{ kind: "regular", approved: null }],
  },
  {
    id: 900003,
    created_at: "2026-09-07T12:00:00+00:00",
    amount: 3,
    external_id: "SELLAVI-7003",
    affiliate: { id: "kidkara2" },
    commissions: [{ kind: "regular", approved: false }], // dis-approved test order
  },
  {
    id: 900004,
    created_at: "2026-09-07T13:00:00+00:00",
    amount: 10,
    external_id: "SELLAVI-7004",
    affiliate: { id: "who-is-this" }, // unknown affiliate → orphaned, never counted
    commissions: [],
  },
];

describe("snapshot transform (raw → file)", () => {
  const file = transform(rawAffiliates, rawConversions, "2026-09-10T03:00:00.000Z");

  it("derives publication-safe display names", () => {
    expect(deriveDisplayName("jordan", "wiggins")).toBe("Jordan W.");
    expect(deriveDisplayName("Marelis", "De La Cruz")).toBe("Marelis D.");
    expect(file.affiliates.map((a) => a.displayName)).toEqual(["Lee V.", "Kara D.", "Konnor Q."]);
  });

  it("strips every PII field — no emails, phones or addresses survive", () => {
    const text = JSON.stringify(file);
    expect(text).not.toContain("@example.test");
    expect(text).not.toContain("555-0100");
    expect(text).not.toContain("Testville");
    expect(text).not.toContain("custom_fields");
  });

  it("flags Tapfiliate-disapproved conversions and quarantines orphans", () => {
    const byExt = new Map(file.conversions.map((c) => [c.externalId, c]));
    expect(byExt.get("SELLAVI-7003")!.excluded).toBe(true);
    expect(byExt.get("SELLAVI-7003")!.excludedReason).toBe("commission_disapproved");
    expect(byExt.get("SELLAVI-7002")!.excluded).toBe(false);
    expect(file.conversions).toHaveLength(3);
    expect(file.orphanConversionIds).toEqual([900004]);
  });

  it("keeps raw external ids stable but tidies the doubled prefix for display", () => {
    const doubled = file.conversions.find((c) => c.id === "tap-900001")!;
    expect(doubled.externalId).toBe("SELLAVI-SELLAVI-7001");
    expect(doubled.orderRef).toBe("#SELLAVI-7001");
  });
});

describe("snapshot store (file → board)", () => {
  const file = transform(rawAffiliates, rawConversions, "2026-09-10T03:00:00.000Z");
  const store = new DemoStore({
    data: buildSnapshotData(file, Date.parse("2026-09-10T04:00:00Z")),
    mode: "snapshot",
    generatedAtMs: Date.parse(file.generatedAt),
    policyNote: file.policyNote,
  });
  const board = (scope: "personal" | "team") =>
    store.board({ scope, period: "monthly", page: 1, pageSize: 50, search: "", sort: "sales", dir: "desc" });

  it("personal board counts eligible checkouts and excludes disapproved ones", () => {
    const rows = board("personal").rows;
    const amount = (id: string) => rows.find((r) => r.affiliateId === id)!.amountCents;
    expect(amount("kidkara2")).toBe(9_997); // $3 disapproved order not added
    expect(amount("kidkonnor3")).toBe(6_498);
    expect(amount("leaderlee1")).toBe(0);
  });

  it("team totals roll verified MLM parents up without double counting", () => {
    const rows = board("team").rows;
    const lee = rows.find((r) => r.affiliateId === "leaderlee1")!;
    const kara = rows.find((r) => r.affiliateId === "kidkara2")!;
    expect(lee.amountCents).toBe(9_997 + 6_498); // whole downline once
    expect(kara.amountCents).toBe(9_997 + 6_498); // self + child
    expect(board("team").disconnectedCount).toBe(0);
  });

  it("first sync is honest: no movement, no members, launch pending", () => {
    expect(board("personal").hasSnapshot).toBe(false);
    expect(store.recognition()).toHaveLength(0);
    const ch = store.challenge("kidkara2");
    expect(ch.window).toBeNull();
    expect(ch.status.state).toBe("not_started");
    expect(store.seatsClaimed()).toBe(0);
  });

  it("is read-only: mutations refuse and the sync stamp stays fixed", () => {
    expect(store.readOnly).toBe(true);
    expect(store.meLabel).toBe("Viewing");
    expect(store.lastSyncMs).toBe(Date.parse("2026-09-10T03:00:00.000Z"));
    expect(store.approve("anything", "reason long enough").ok).toBe(false);
    expect(store.correctTxn("tap-900001", { paymentStatus: "unpaid" }, "reason long enough").ok).toBe(false);
    expect(store.setLaunchDate("2026-10-01T00:00:00Z", "reason long enough").ok).toBe(false);
    const before = store.lastSyncMs;
    store.refreshNow();
    expect(store.lastSyncMs).toBe(before);
  });

  it("defaults the inspected viewer to the top eligible seller", () => {
    expect(store.viewerId).toBe("kidkara2");
  });
});
