import { describe, expect, it } from "vitest";
import {
  compileRule,
  evaluateContent,
  groupViolations,
  segmentByViolations,
  type ComplianceRuleInput,
} from "@/server/compliance/engine";

const rule = (
  r: Partial<ComplianceRuleInput> & Pick<ComplianceRuleInput, "pattern">,
): ComplianceRuleInput => ({
  id: r.pattern,
  type: "BLOCKLIST_TERM",
  isRegex: false,
  channels: [],
  severity: "HIGH",
  description: "test",
  ...r,
});

const RULES: ComplianceRuleInput[] = [
  rule({
    pattern: "\\b(cures?|treats?|heals?)\\b",
    isRegex: true,
    type: "MEDICAL_CLAIM",
    severity: "CRITICAL",
  }),
  rule({ pattern: "BPC-157", type: "PEPTIDE_NAME", channels: ["INSTAGRAM", "TIKTOK"] }),
  rule({ pattern: "miracle", severity: "MEDIUM" }),
  rule({ pattern: "before and after", type: "PLATFORM_RULE", channels: ["TIKTOK"] }),
];

describe("evaluateContent", () => {
  it("passes clean educational content", () => {
    expect(
      evaluateContent("Recovery is a routine. Which habit are you building?", "INSTAGRAM", RULES),
    ).toEqual({
      outcome: "PASS",
      risk: "LOW",
      violations: [],
    });
  });

  it("fails medical claims at critical risk", () => {
    const r = evaluateContent("This stack cures soreness.", "FACEBOOK", RULES);
    expect(r.outcome).toBe("FAIL");
    expect(r.risk).toBe("CRITICAL");
    expect(r.violations[0]).toMatchObject({ match: "cures", type: "MEDICAL_CLAIM" });
  });

  it("only warns for medium findings", () => {
    const r = evaluateContent("A Miracle morning routine", "FACEBOOK", RULES);
    expect(r).toMatchObject({ outcome: "WARN", risk: "MEDIUM" });
    expect(r.violations[0]!.match).toBe("Miracle");
  });

  it("applies channel-specific rules only on their channels", () => {
    expect(evaluateContent("Learn about BPC-157", "INSTAGRAM", RULES).outcome).toBe("FAIL");
    expect(evaluateContent("Learn about BPC-157", "EMAIL", RULES).outcome).toBe("PASS");
    expect(evaluateContent("before and after photos", "TIKTOK", RULES).outcome).toBe("FAIL");
    expect(evaluateContent("before and after photos", "YOUTUBE", RULES).outcome).toBe("PASS");
  });

  it("matches whole words only and tolerates extra spaces", () => {
    expect(evaluateContent("miraculous", "FACEBOOK", RULES).outcome).toBe("PASS");
    expect(evaluateContent("before   and\nafter", "TIKTOK", RULES).outcome).toBe("FAIL");
  });

  it("reports every finding in text order and the highest risk", () => {
    const r = evaluateContent("A miracle that heals. Also cures.", "FACEBOOK", RULES);
    expect(r.violations.map((v) => v.match)).toEqual(["miracle", "heals", "cures"]);
    expect(r.risk).toBe("CRITICAL");
  });

  it("ignores inactive rules and invalid regular expressions", () => {
    const rules = [
      rule({ pattern: "miracle", active: false }),
      rule({ pattern: "([unclosed", isRegex: true }),
    ];
    expect(evaluateContent("miracle ([unclosed", "FACEBOOK", rules).outcome).toBe("PASS");
    expect(compileRule({ pattern: "([unclosed", isRegex: true })).toBeNull();
  });

  it("escapes special characters in plain terms", () => {
    const r = evaluateContent("Try C++ today, not C", "FACEBOOK", [rule({ pattern: "C++" })]);
    expect(r.violations).toHaveLength(1);
  });
});

describe("groupViolations", () => {
  it("collapses the same phrase found in title and caption, most severe first", () => {
    const { violations } = evaluateContent(
      "Cures it\nThis cures it. A miracle.",
      "FACEBOOK",
      RULES,
    );
    const grouped = groupViolations(violations);
    expect(grouped.map((g) => [g.match.toLowerCase(), g.count])).toEqual([
      ["cures", 2],
      ["miracle", 1],
    ]);
  });
});

describe("segmentByViolations", () => {
  it("splits text around flagged phrases", () => {
    const text = "This cures it";
    const { violations } = evaluateContent(text, "FACEBOOK", RULES);
    const segments = segmentByViolations(text, violations);
    expect(segments.map((s) => s.text)).toEqual(["This ", "cures", " it"]);
    expect(segments[1]!.violation?.severity).toBe("CRITICAL");
  });
});
