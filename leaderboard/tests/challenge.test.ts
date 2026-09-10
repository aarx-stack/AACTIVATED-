import { describe, expect, it } from "vitest";
import {
  challengeStatus,
  challengeWindow,
  foundersPackProgress,
  membershipExpiry,
  type ChallengeStatusInput,
  type PathProgress,
} from "@shared/challenge";
import { totalsInRange } from "@shared/eligibility";
import { DAY_MS } from "@shared/time";
import { DEFAULT_POLICY, type ChallengeConfig, type Membership } from "@shared/types";
import { txn } from "./helpers/factory";

const cfg: ChallengeConfig = {
  launchAt: "2026-07-15T16:00:00.000Z",
  launchIsDemoSample: false,
  windowDays: 30,
  directTargetCents: 1_000_000,
  teamTargetCents: 5_000_000,
  foundersPackMinCents: 250_000,
  seatCap: 50,
  policy: DEFAULT_POLICY,
  policyConfirmed: true,
};

const LAUNCH = Date.parse(cfg.launchAt!);

const noProgress: PathProgress = {
  directCents: 0,
  teamCents: 0,
  foundersPack: { present: false, txnId: null, verified: false, awaitingPayment: false },
};

function statusOf(input: Partial<ChallengeStatusInput>) {
  return challengeStatus(
    {
      nowMs: LAUNCH + 10 * DAY_MS,
      window: { startMs: LAUNCH, endMs: LAUNCH + 30 * DAY_MS },
      membership: null,
      pending: null,
      seatsClaimed: 10,
      seatCap: 50,
      progress: noProgress,
      ...input,
    },
    cfg,
  );
}

describe("challenge windows (enrollment before/after launch)", () => {
  it("enrolled before launch → fresh 30-day window starting at launch", () => {
    const w = challengeWindow(LAUNCH - 90 * DAY_MS, LAUNCH, 30)!;
    expect(w.startMs).toBe(LAUNCH);
    expect(w.endMs).toBe(LAUNCH + 30 * DAY_MS);
  });

  it("enrolled at or after launch → 30 days from enrollment", () => {
    const enrolled = LAUNCH + 12 * DAY_MS;
    const w = challengeWindow(enrolled, LAUNCH, 30)!;
    expect(w.startMs).toBe(enrolled);
    expect(w.endMs).toBe(enrolled + 30 * DAY_MS);
    // exactly at launch counts as "on or after"
    expect(challengeWindow(LAUNCH, LAUNCH, 30)!.startMs).toBe(LAUNCH);
  });

  it("no launch configured → no window (Launch date pending)", () => {
    expect(challengeWindow(LAUNCH, null, 30)).toBeNull();
    expect(statusOf({ window: null }).state).toBe("not_started");
  });

  it("window is exactly 720 hours (24h days, DST-independent)", () => {
    const w = challengeWindow(Date.parse("2026-10-20T00:00:00Z"), LAUNCH, 30)!;
    expect(w.endMs - w.startMs).toBe(30 * 24 * 3_600_000);
  });
});

describe("qualification deadline boundaries (half-open window)", () => {
  const w = { startMs: LAUNCH, endMs: LAUNCH + 30 * DAY_MS };

  it("a sale at the opening instant counts; one at the closing instant does not", () => {
    const atStart = txn({ occurredAt: new Date(w.startMs).toISOString(), grossCents: 10_000 });
    const lastMs = txn({ occurredAt: new Date(w.endMs - 1).toISOString(), grossCents: 10_000 });
    const atEnd = txn({ occurredAt: new Date(w.endMs).toISOString(), grossCents: 10_000 });
    const t = totalsInRange([atStart, lastMs, atEnd], cfg.policy, w);
    expect(t.amountCents).toBe(20_000);
  });

  it("status flips to window_ended exactly at endMs", () => {
    expect(statusOf({ nowMs: w.endMs - 1, progress: { ...noProgress, directCents: 1 } }).state).toBe("in_progress");
    expect(statusOf({ nowMs: w.endMs }).state).toBe("window_ended");
  });
});

describe("status precedence", () => {
  const membership: Membership = {
    affiliateId: "aff-1",
    seatNo: 7,
    path: "direct",
    qualifiedAt: new Date(LAUNCH + 5 * DAY_MS).toISOString(),
    verifiedAt: new Date(LAUNCH + 6 * DAY_MS).toISOString(),
    membershipExpiresAt: new Date(membershipExpiry(LAUNCH + 6 * DAY_MS)).toISOString(),
  };

  it("qualified beats everything, and expires into membership_expired after one year", () => {
    expect(statusOf({ membership, seatsClaimed: 50 }).state).toBe("qualified");
    expect(statusOf({ membership, nowMs: LAUNCH + 6 * DAY_MS + 366 * DAY_MS }).state).toBe("membership_expired");
  });

  it("pending verification survives the window closing", () => {
    const s = statusOf({
      nowMs: LAUNCH + 40 * DAY_MS, // window over
      pending: { affiliateId: "aff-1", path: "founders_pack", submittedAt: new Date(LAUNCH + 20 * DAY_MS).toISOString(), txnId: "t-1" },
    });
    expect(s.state).toBe("pending_verification");
  });

  it("capacity reached once all seats are verified-claimed", () => {
    expect(statusOf({ seatsClaimed: 50 }).state).toBe("capacity_reached");
  });

  it("not started before the window opens; in progress only once there is progress", () => {
    expect(statusOf({ nowMs: LAUNCH - DAY_MS }).state).toBe("not_started");
    expect(statusOf({}).state).toBe("not_started"); // open window, zero progress
    expect(statusOf({ progress: { ...noProgress, directCents: 100 } }).state).toBe("in_progress");
  });
});

describe("founders pack path", () => {
  const w = { startMs: LAUNCH, endMs: LAUNCH + 30 * DAY_MS };

  it("verified $2,500 pack inside the window qualifies; the same sale counts once as revenue", () => {
    const pack = txn({
      occurredAt: new Date(LAUNCH + 3 * DAY_MS).toISOString(),
      grossCents: 250_000,
      isFoundersPack: true,
    });
    const fp = foundersPackProgress([pack], cfg, w);
    expect(fp.verified).toBe(true);
    // Same ledger row, same policy → exactly one count of $2,500 in sales.
    const totals = totalsInRange([pack], cfg.policy, w);
    expect(totals).toEqual({ amountCents: 250_000, orders: 1 });
  });

  it("unverified (Zelle-pending) pack is awaitingPayment, not qualified", () => {
    const pack = txn({
      occurredAt: new Date(LAUNCH + 3 * DAY_MS).toISOString(),
      grossCents: 250_000,
      isFoundersPack: true,
      paymentStatus: "pending",
      paymentVerified: false,
    });
    const fp = foundersPackProgress([pack], cfg, w);
    expect(fp.verified).toBe(false);
    expect(fp.awaitingPayment).toBe(true);
  });

  it("packs outside the window or under the minimum never qualify", () => {
    const late = txn({ occurredAt: new Date(w.endMs).toISOString(), grossCents: 250_000, isFoundersPack: true });
    const cheap = txn({ occurredAt: new Date(LAUNCH + DAY_MS).toISOString(), grossCents: 200_000, isFoundersPack: true });
    expect(foundersPackProgress([late], cfg, w).present).toBe(false);
    expect(foundersPackProgress([cheap], cfg, w).present).toBe(false);
  });
});

describe("monthly rankings stay independent of challenge windows", () => {
  it("a sale after the window still counts for the month it happened in", () => {
    // Window ended Aug 14; sale on Sep 5 counts in September's ranking but
    // adds nothing to window progress.
    const w = { startMs: LAUNCH, endMs: LAUNCH + 30 * DAY_MS }; // Jul 15 → Aug 14
    const septSale = txn({ occurredAt: "2026-09-05T12:00:00.000Z", grossCents: 50_000 });
    const month = { startMs: Date.parse("2026-09-01T07:00:00Z"), endMs: Date.parse("2026-10-01T07:00:00Z") };
    expect(totalsInRange([septSale], cfg.policy, month).amountCents).toBe(50_000);
    expect(totalsInRange([septSale], cfg.policy, w).amountCents).toBe(0);
  });
});
