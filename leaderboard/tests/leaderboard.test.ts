import { describe, expect, it } from "vitest";
import { movement, rank } from "@shared/leaderboard";

describe("ranking & movement", () => {
  it("ranks deterministically: amount desc, orders desc, then name", () => {
    const rows = rank([
      { affiliateId: "b", displayName: "Beta", amountCents: 100, orders: 2 },
      { affiliateId: "a", displayName: "Alpha", amountCents: 100, orders: 2 },
      { affiliateId: "c", displayName: "Gamma", amountCents: 100, orders: 5 },
      { affiliateId: "d", displayName: "Delta", amountCents: 900, orders: 1 },
    ]);
    expect(rows.map((r) => r.affiliateId)).toEqual(["d", "c", "a", "b"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("movement requires a snapshot: none → null (UI must hide movement)", () => {
    const current = rank([{ affiliateId: "a", displayName: "A", amountCents: 1, orders: 1 }]);
    expect(movement(current, null)).toBeNull();
  });

  it("movement is prevRank − currentRank; unseen entrants are 'new'", () => {
    const current = rank([
      { affiliateId: "a", displayName: "A", amountCents: 300, orders: 1 },
      { affiliateId: "b", displayName: "B", amountCents: 200, orders: 1 },
      { affiliateId: "c", displayName: "C", amountCents: 100, orders: 1 },
    ]);
    const snapshot = [
      { affiliateId: "b", rank: 1 },
      { affiliateId: "a", rank: 2 },
    ];
    const m = movement(current, snapshot)!;
    expect(m.get("a")).toBe(1); // 2 → 1
    expect(m.get("b")).toBe(-1); // 1 → 2
    expect(m.get("c")).toBe("new");
  });
});
