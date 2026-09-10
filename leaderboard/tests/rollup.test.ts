import { describe, expect, it } from "vitest";
import { teamRollup } from "@shared/rollup";
import type { TeamEdge } from "@shared/types";

const E = (parentId: string, childId: string, verified = true): TeamEdge => ({
  parentId,
  childId,
  verified,
  source: "tapfiliate_mlm",
});

describe("team rollups (double-counting prevention)", () => {
  it("counts each descendant's sales exactly once per ancestor line", () => {
    // marcus → james → aaliyah ; marcus → priya
    const edges = [E("marcus", "james"), E("james", "aaliyah"), E("marcus", "priya")];
    const amounts = new Map([
      ["marcus", 1000],
      ["james", 500],
      ["aaliyah", 200],
      ["priya", 300],
    ]);
    const r = teamRollup(["marcus", "james", "aaliyah", "priya"], edges, amounts, new Map(), "self_plus_descendants");
    expect(r.amounts.get("marcus")).toBe(2000); // 1000+500+200+300 — aaliyah once, not twice
    expect(r.amounts.get("james")).toBe(700);
    expect(r.amounts.get("aaliyah")).toBe(200);
  });

  it("duplicate edges and cycles cannot inflate totals", () => {
    const edges = [
      E("a", "b"),
      E("a", "b"), // duplicate delivery of the same relationship
      E("b", "c"),
      E("c", "a"), // cycle back to the root
    ];
    const amounts = new Map([
      ["a", 100],
      ["b", 100],
      ["c", 100],
    ]);
    const r = teamRollup(["a", "b", "c"], edges, amounts, new Map(), "self_plus_descendants");
    expect(r.amounts.get("a")).toBe(300);
    expect(r.amounts.get("b")).toBe(300); // b → c → a (cycle-safe, each once)
  });

  it("commission records are structurally excluded: totals come from personal amounts only", () => {
    // An MLM source may emit 3 commission rows for one $100 sale (levels 1-3).
    // The rollup API only accepts per-affiliate personal revenue, so those
    // rows have nowhere to enter — the sale contributes 100, not 300.
    const edges = [E("l1", "l2"), E("l2", "l3")];
    const amounts = new Map([["l3", 100]]);
    const r = teamRollup(["l1", "l2", "l3"], edges, amounts, new Map(), "self_plus_descendants");
    expect(r.amounts.get("l1")).toBe(100);
    expect(r.amounts.get("l2")).toBe(100);
  });

  it("any unverified edge in the subtree → 'team data not connected', not a guess", () => {
    const edges = [E("riley", "hana", false), E("riley", "oliver", false), E("ava", "zoe")];
    const amounts = new Map([
      ["riley", 500],
      ["hana", 100],
      ["ava", 400],
      ["zoe", 50],
    ]);
    const r = teamRollup(["riley", "ava"], edges, amounts, new Map(), "self_plus_descendants");
    expect(r.disconnected.has("riley")).toBe(true);
    expect(r.amounts.has("riley")).toBe(false);
    expect(r.amounts.get("ava")).toBe(450);
  });

  it("descendants_only policy excludes the leader's own sales", () => {
    const edges = [E("lead", "kid")];
    const amounts = new Map([
      ["lead", 900],
      ["kid", 100],
    ]);
    const r = teamRollup(["lead"], edges, amounts, new Map(), "descendants_only");
    expect(r.amounts.get("lead")).toBe(100);
  });
});
