import { describe, expect, it } from "vitest";
import { laWallClock, monthRange, utcForLaWallClock, weekRange } from "@shared/time";

describe("America/Los_Angeles reporting boundaries", () => {
  it("resolves LA midnight to the correct UTC instant on both sides of DST", () => {
    // PDT (UTC-7): Sep 1 2026 00:00 LA = 07:00 UTC
    expect(utcForLaWallClock(2026, 9, 1)).toBe(Date.parse("2026-09-01T07:00:00Z"));
    // PST (UTC-8): Dec 1 2026 00:00 LA = 08:00 UTC
    expect(utcForLaWallClock(2026, 12, 1)).toBe(Date.parse("2026-12-01T08:00:00Z"));
  });

  it("survives the DST transitions (spring forward / fall back)", () => {
    // 2026 spring-forward: Mar 8. Midnight is still PST.
    expect(utcForLaWallClock(2026, 3, 8)).toBe(Date.parse("2026-03-08T08:00:00Z"));
    // The nonexistent 02:30 resolves to a real instant whose LA date is Mar 8.
    const gap = utcForLaWallClock(2026, 3, 8, 2, 30);
    expect(laWallClock(gap).day).toBe(8);
    // 2026 fall-back: Nov 1. Midnight is still PDT.
    expect(utcForLaWallClock(2026, 11, 1)).toBe(Date.parse("2026-11-01T07:00:00Z"));
    expect(utcForLaWallClock(2026, 11, 2)).toBe(Date.parse("2026-11-02T08:00:00Z"));
  });

  it("monthRange spans LA calendar months and carries a stable key", () => {
    const now = Date.parse("2026-09-10T18:00:00Z");
    const m = monthRange(now);
    expect(m.key).toBe("2026-09");
    expect(m.startMs).toBe(Date.parse("2026-09-01T07:00:00Z"));
    expect(m.endMs).toBe(Date.parse("2026-10-01T07:00:00Z"));
  });

  it("weekRange starts Monday 00:00 LA and is exactly one LA week long", () => {
    // Thu Sep 10 2026 (LA) → Monday Sep 7 2026.
    const now = Date.parse("2026-09-10T18:00:00Z");
    const w = weekRange(now);
    expect(w.key).toBe("wk-2026-09-07");
    expect(w.startMs).toBe(Date.parse("2026-09-07T07:00:00Z"));
    expect(w.endMs).toBe(Date.parse("2026-09-14T07:00:00Z"));
    expect(laWallClock(w.startMs).weekday).toBe(1);
  });

  it("weekRange spanning fall-back is 169 hours of real time, not 168", () => {
    // Week of Mon Oct 26 2026 contains Nov 1 (fall back): Monday-to-Monday
    // in LA wall-clock includes the repeated hour.
    const now = Date.parse("2026-10-28T18:00:00Z");
    const w = weekRange(now);
    expect(w.key).toBe("wk-2026-10-26");
    expect((w.endMs! - w.startMs) / 3_600_000).toBe(169);
  });
});
