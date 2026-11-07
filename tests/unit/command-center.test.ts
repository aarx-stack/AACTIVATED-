import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { scoreDepartment } from "@/server/queries/department-health";
import { CONFIDENTIAL_PLACEHOLDER, redactFeedItem } from "@/server/queries/redaction";

describe("scoreDepartment", () => {
  it("is healthy when every agent is fine and nothing is blocked", () => {
    expect(
      scoreDepartment({ agentStatuses: ["ACTIVE", "IDLE"], blockedTasks: 0, overdueTasks: 0 }),
    ).toEqual({
      score: 100,
      band: "healthy",
      reasons: ["On track"],
    });
  });

  it("drops to at-risk when an agent errors", () => {
    const h = scoreDepartment({ agentStatuses: ["ERROR"], blockedTasks: 1, overdueTasks: 0 });
    expect(h.band).toBe("at_risk");
    expect(h.reasons).toContain("1 agent in error");
    expect(h.reasons).toContain("1 blocked task");
  });

  it("is on watch when an agent is paused", () => {
    expect(
      scoreDepartment({ agentStatuses: ["PAUSED"], blockedTasks: 0, overdueTasks: 0 }).band,
    ).toBe("watch");
  });

  it("caps penalties and never goes below zero", () => {
    const h = scoreDepartment({
      agentStatuses: ["ERROR", "ERROR", "ERROR"],
      blockedTasks: 99,
      overdueTasks: 99,
    });
    expect(h.score).toBe(0);
  });

  it("flags a department without agents", () => {
    expect(scoreDepartment({ agentStatuses: [], blockedTasks: 0, overdueTasks: 0 }).band).toBe(
      "at_risk",
    );
  });
});

describe("redactFeedItem", () => {
  const confidential = {
    message: "Reviewed contract with vendor X",
    department: { name: "Legal & Compliance", isConfidential: true },
  };
  const open = {
    message: "Drafted post 2",
    department: { name: "Marketing", isConfidential: false },
  };

  it("shows executives everything", () => {
    expect(redactFeedItem(confidential, Role.EXECUTIVE).message).toBe(confidential.message);
  });

  it("hides confidential details from every other role", () => {
    for (const role of [Role.STAFF, Role.SYSTEM_ADMIN, Role.PREMIUM_REP, Role.FREE_REP]) {
      expect(redactFeedItem(confidential, role).message).toBe(CONFIDENTIAL_PLACEHOLDER);
    }
  });

  it("leaves non-confidential activity untouched", () => {
    expect(redactFeedItem(open, Role.STAFF)).toBe(open);
  });
});
