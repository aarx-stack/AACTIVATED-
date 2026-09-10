import { describe, expect, it } from "vitest";
import { claimSeat, seatsClaimed } from "@worker/domain/seats";
import { openTestDb, seedAffiliate } from "./helpers/sqlite";

const claimArgs = (affiliateId: string) => ({
  affiliateId,
  path: "founders_pack" as const,
  qualifiedAt: "2026-08-01T00:00:00.000Z",
  verifiedAt: new Date().toISOString(),
  membershipExpiresAt: "2027-08-01T00:00:00.000Z",
  seatCap: 50,
});

describe("atomic seat allocation (50-seat cap)", () => {
  it("60 competing claimants → exactly 50 seats, dense 1..50, no duplicates", async () => {
    const { db } = openTestDb();
    for (let i = 1; i <= 60; i++) await seedAffiliate(db, `aff-${i}`);

    // Fire all claims as interleaved promises; SQLite (like D1) serializes
    // the guarded single-statement INSERT, so the cap cannot be overrun.
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => claimSeat(db, claimArgs(`aff-${i + 1}`))),
    );

    const claimed = results.filter((r) => r.result === "claimed");
    const capacity = results.filter((r) => r.result === "capacity");
    expect(claimed).toHaveLength(50);
    expect(capacity).toHaveLength(10);
    expect(await seatsClaimed(db)).toBe(50);

    const seats = claimed.map((r) => r.seatNo!).sort((a, b) => a - b);
    expect(seats).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("concurrent attempts on the FINAL seat: exactly one wins", async () => {
    const { db } = openTestDb();
    for (let i = 1; i <= 55; i++) await seedAffiliate(db, `aff-${i}`);
    for (let i = 1; i <= 49; i++) await claimSeat(db, claimArgs(`aff-${i}`));
    expect(await seatsClaimed(db)).toBe(49);

    const contenders = ["aff-50", "aff-51", "aff-52", "aff-53", "aff-54", "aff-55"];
    const results = await Promise.all(contenders.map((a) => claimSeat(db, claimArgs(a))));
    expect(results.filter((r) => r.result === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.result === "capacity")).toHaveLength(5);
    expect(await seatsClaimed(db)).toBe(50);
  });

  it("an affiliate can never hold two seats", async () => {
    const { db } = openTestDb();
    await seedAffiliate(db, "aff-1");
    const first = await claimSeat(db, claimArgs("aff-1"));
    const second = await claimSeat(db, claimArgs("aff-1"));
    expect(first.result).toBe("claimed");
    expect(second).toEqual({ result: "already_member", seatNo: first.seatNo });
    expect(await seatsClaimed(db)).toBe(1);
  });
});
