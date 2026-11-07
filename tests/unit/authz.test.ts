import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import {
  ALL_PERMISSIONS,
  authorize,
  can,
  ForbiddenError,
  type Permission,
  permissionsFor,
  UnauthenticatedError,
} from "@/server/authz/permissions";

const { EXECUTIVE: E, STAFF: S, PREMIUM_REP: P, FREE_REP: F, SYSTEM_ADMIN: A } = Role;
const ROLES = [E, S, P, F, A];

/**
 * The expected matrix, written out independently of the implementation.
 * Changing a permission in code without updating this table fails the build.
 */
const EXPECTED: Record<Permission, Role[]> = {
  "command_center.view": [E, S, A],
  "brain.ask": [E, S],
  "company_team.view": [E, S, A],
  "agent.view": [E, S],
  "agent.manage": [E],
  "rep_pod.full": [P],
  "rep_pod.coach": [P, F],
  "back_office.view_own": [P, F],
  "content_studio.view": [E, S, P],
  "approvals.view": [E, S],
  "approvals.decide_standard": [E, S],
  "approvals.decide_restricted": [E],
  "compliance_rules.manage": [E],
  "finance.view": [E],
  "budget.manage": [E],
  "knowledge.view": [E, S, P, F, A],
  "prompts.use": [E, S],
  "confidential.legal": [E],
  "confidential.accounting": [E],
  "confidential.hr": [E],
  "roadmap.view": [E, S, A],
  "roadmap.approve_launch": [E],
  "admin.view": [E, A],
  "users.manage": [E, A],
  "integrations.manage": [A],
  "audit_log.view": [E, A],
  "system_status.view": [E, S, A],
  "account.manage_own": [E, S, P, F, A],
};

describe("permission matrix", () => {
  it("covers exactly the permissions defined in code", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  for (const permission of Object.keys(EXPECTED) as Permission[]) {
    for (const role of ROLES) {
      const allowed = EXPECTED[permission].includes(role);
      it(`${role} ${allowed ? "can" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(allowed);
      });
    }
  }
});

describe("business rules", () => {
  it("keeps legal, corporate accounting and HR executive-only", () => {
    for (const p of [
      "confidential.legal",
      "confidential.accounting",
      "confidential.hr",
      "finance.view",
    ] as const) {
      expect(ROLES.filter((r) => can(r, p))).toEqual([E]);
    }
  });

  it("gives a FREE_REP only the Business Coach, earnings and shared basics", () => {
    expect(permissionsFor(F).sort()).toEqual(
      ["rep_pod.coach", "back_office.view_own", "knowledge.view", "account.manage_own"].sort(),
    );
  });

  it("gives a PREMIUM_REP the full pod but no company areas", () => {
    expect(can(P, "rep_pod.full")).toBe(true);
    expect(can(P, "rep_pod.coach")).toBe(true);
    for (const p of [
      "command_center.view",
      "approvals.view",
      "finance.view",
      "admin.view",
      "agent.view",
    ] as const) {
      expect(can(P, p)).toBe(false);
    }
  });

  it("never lets reps or the system admin approve outbound items", () => {
    for (const role of [P, F, A]) {
      expect(can(role, "approvals.decide_standard")).toBe(false);
      expect(can(role, "approvals.decide_restricted")).toBe(false);
    }
  });

  it("reserves restricted approvals and launches for executives", () => {
    expect(ROLES.filter((r) => can(r, "approvals.decide_restricted"))).toEqual([E]);
    expect(ROLES.filter((r) => can(r, "roadmap.approve_launch"))).toEqual([E]);
  });

  it("denies everything to a missing role", () => {
    for (const p of ALL_PERMISSIONS) expect(can(null, p)).toBe(false);
  });
});

describe("authorize()", () => {
  it("throws UnauthenticatedError without a user", () => {
    expect(() => authorize(null, "knowledge.view")).toThrow(UnauthenticatedError);
  });

  it("throws ForbiddenError when the role lacks the permission", () => {
    expect(() => authorize({ id: "u1", role: S }, "finance.view")).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError for a suspended executive", () => {
    expect(() => authorize({ id: "u1", role: E, status: "SUSPENDED" }, "finance.view")).toThrow(
      ForbiddenError,
    );
  });

  it("passes for an active user with the permission", () => {
    expect(() => authorize({ id: "u1", role: E, status: "ACTIVE" }, "finance.view")).not.toThrow();
  });
});
