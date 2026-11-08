import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import {
  decideAdvance,
  isGatedMove,
  nextPhase,
  overallProgress,
  stageStates,
} from "@/server/roadmap/policy";

const open = {
  phase: "BUILD",
  locked: false,
  requiresExecutiveApproval: false,
  isTokenization: false,
} as const;

describe("roadmap policy", () => {
  it("moves one phase at a time and stops at Launch", () => {
    expect(nextPhase("IDEA")).toBe("BUILD");
    expect(nextPhase("REVIEW")).toBe("LAUNCH");
    expect(nextPhase("LAUNCH")).toBeNull();
  });

  it("gates locked projects, the tokenization platform, and launches that need approval", () => {
    expect(isGatedMove(open, "REVIEW")).toBe(false);
    expect(isGatedMove({ ...open, locked: true }, "REVIEW")).toBe(true);
    expect(isGatedMove({ ...open, isTokenization: true }, "REVIEW")).toBe(true);
    expect(isGatedMove({ ...open, requiresExecutiveApproval: true }, "REVIEW")).toBe(false);
    expect(isGatedMove({ ...open, requiresExecutiveApproval: true }, "LAUNCH")).toBe(true);
  });

  it("staff move ungated projects and request approval for gated ones", () => {
    expect(decideAdvance(Role.STAFF, open)).toEqual({
      action: "advance",
      to: "REVIEW",
      noteRequired: false,
    });
    expect(decideAdvance(Role.STAFF, { ...open, isTokenization: true })).toEqual({
      action: "request",
      to: "REVIEW",
    });
  });

  it("executives decide gated moves, with a note", () => {
    expect(decideAdvance(Role.EXECUTIVE, { ...open, locked: true })).toEqual({
      action: "advance",
      to: "REVIEW",
      noteRequired: true,
    });
  });

  it("reps, admins and launched projects cannot move", () => {
    expect(decideAdvance(Role.PREMIUM_REP, open).action).toBe("refuse");
    expect(decideAdvance(Role.SYSTEM_ADMIN, open).action).toBe("refuse");
    expect(decideAdvance(Role.EXECUTIVE, { ...open, phase: "LAUNCH" }).action).toBe("refuse");
  });

  it("draws the tokenization platform's later steps as locked", () => {
    expect(stageStates({ ...open, isTokenization: true })).toEqual({
      IDEA: "done",
      BUILD: "current",
      REVIEW: "locked",
      LAUNCH: "locked",
    });
    expect(stageStates({ ...open, phase: "IDEA" })).toEqual({
      IDEA: "current",
      BUILD: "next",
      REVIEW: "later",
      LAUNCH: "later",
    });
  });

  it("overall progress counts phases and progress within them", () => {
    expect(overallProgress([])).toBe(0);
    expect(overallProgress([{ phase: "LAUNCH", progress: 100 }])).toBe(1);
    expect(overallProgress([{ phase: "IDEA", progress: 0 }])).toBe(0);
    expect(overallProgress([{ phase: "BUILD", progress: 50 }])).toBeCloseTo(0.5);
  });
});
