/**
 * Demo dataset invariants: the fixtures must actually demonstrate every
 * advertised state, and the demo store must agree with the shared domain
 * logic (it uses it directly, so these double as integration checks).
 */
import { describe, expect, it } from "vitest";
import { buildDemoData, affId } from "../src/data/fixtures";
import { DemoStore } from "../src/data/store";

const now = Date.now();

describe("demo fixtures", () => {
  const data = buildDemoData(now);

  it("43 of 50 baseline seats, +7 for the seats-full toggle, dense seat numbers", () => {
    expect(data.memberships).toHaveLength(43);
    expect(data.extraMemberships).toHaveLength(7);
    const seats = [...data.memberships, ...data.extraMemberships].map((m) => m.seatNo).sort((a, b) => a - b);
    expect(seats).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("seat order follows verification order", () => {
    const verified = data.memberships.map((m) => Date.parse(m.verifiedAt));
    const sorted = [...verified].sort((a, b) => a - b);
    expect(verified).toEqual(sorted);
  });

  it("persona members exist and every qualification sits inside its own window", () => {
    const launch = Date.parse(data.config.launchAt!);
    for (const name of ["Marcus Webb", "Diego Fuentes", "Grace Kim", "Tara Singh", "Dana Whitfield"] as const) {
      expect(data.memberships.some((m) => m.affiliateId === affId(name)), name).toBe(true);
    }
    for (const m of [...data.memberships, ...data.extraMemberships]) {
      const aff = data.affiliates.find((a) => a.id === m.affiliateId)!;
      const start = Math.max(Date.parse(aff.enrolledAt), launch);
      const end = start + 30 * 86_400_000;
      const q = Date.parse(m.qualifiedAt);
      expect(q, `${aff.displayName} qualifiedAt in window`).toBeGreaterThanOrEqual(start);
      expect(q, `${aff.displayName} qualifiedAt in window`).toBeLessThan(end);
    }
  });
});

describe("demo store personas", () => {
  const store = new DemoStore();

  const stateOf = (name: Parameters<typeof affId>[0]) => store.challenge(affId(name)).status.state;

  it("covers every advertised challenge state", () => {
    expect(stateOf("Ava Chen")).toBe("in_progress");
    expect(stateOf("Marcus Webb")).toBe("qualified");
    expect(stateOf("Elena Rodriguez")).toBe("pending_verification");
    expect(stateOf("Chris Okafor")).toBe("not_started");
    expect(stateOf("Trent Kowalski")).toBe("window_ended");
    expect(stateOf("Dana Whitfield")).toBe("membership_expired");
  });

  it("Ava's direct-path progress is the scripted $7,420 of $10,000", () => {
    expect(store.challenge(affId("Ava Chen")).progress.directCents).toBe(742_000);
  });

  it("Riley's team data is not connected (unverified edges) and is hidden from the team board", () => {
    const ch = store.challenge(affId("Riley Nakamura"));
    expect(ch.progress.teamCents).toBeNull();
    const board = store.board({ scope: "team", period: "monthly", page: 1, pageSize: 100, search: "", sort: "sales", dir: "desc" });
    expect(board.rows.some((r) => r.affiliateId === affId("Riley Nakamura"))).toBe(false);
    expect(board.disconnectedCount).toBeGreaterThan(0);
  });

  it("seats-full toggle flips an in-progress affiliate to capacity_reached, qualified members keep their seat", () => {
    store.setSeatsFull(true);
    expect(store.seatsClaimed()).toBe(50);
    expect(stateOf("Ava Chen")).toBe("capacity_reached");
    expect(stateOf("Marcus Webb")).toBe("qualified");
    expect(store.recognition()).toHaveLength(50);
    store.setSeatsFull(false);
    expect(stateOf("Ava Chen")).toBe("in_progress");
  });

  it("monthly rankings include affiliates whose challenge window already ended", () => {
    // Trent's window closed ~45 days ago, but his September sales still rank.
    const board = store.board({ scope: "personal", period: "monthly", page: 1, pageSize: 100, search: "", sort: "sales", dir: "desc" });
    const trent = board.rows.find((r) => r.affiliateId === affId("Trent Kowalski"));
    expect(trent).toBeDefined();
    expect(stateOf("Trent Kowalski")).toBe("window_ended");
  });

  it("movement renders only where a snapshot exists (monthly yes, weekly no)", () => {
    const monthly = store.board({ scope: "personal", period: "monthly", page: 1, pageSize: 10, search: "", sort: "sales", dir: "desc" });
    const weekly = store.board({ scope: "personal", period: "weekly", page: 1, pageSize: 10, search: "", sort: "sales", dir: "desc" });
    expect(monthly.hasSnapshot).toBe(true);
    expect(weekly.hasSnapshot).toBe(false);
    expect(weekly.rows.every((r) => r.movement === null)).toBe(true);
  });

  it("suspended affiliates never appear on the board", () => {
    const board = store.board({ scope: "personal", period: "alltime", page: 1, pageSize: 100, search: "", sort: "sales", dir: "desc" });
    expect(board.rows.some((r) => r.affiliateId === affId("Viktor Petrov"))).toBe(false);
  });

  it("approving Elena's Founders Pack claims the next seat and updates her state", () => {
    const res = store.approve("rq-1", "Zelle payment confirmed by bank statement (demo).");
    expect(res.ok).toBe(true);
    expect(stateOf("Elena Rodriguez")).toBe("qualified");
    expect(store.seatsClaimed()).toBe(44);
    expect(store.audit()[0]!.action).toBe("founders_pack.verified");
  });
});
