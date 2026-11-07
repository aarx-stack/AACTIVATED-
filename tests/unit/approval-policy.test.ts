import { describe, expect, it } from "vitest";
import { ApprovalStatus, ApprovalType, RiskLevel, Role } from "@/generated/prisma/enums";
import {
  canDecideApproval,
  requiredRoleFor,
  RESTRICTED_APPROVAL_TYPES,
} from "@/server/approvals/policy";
import type { Actor } from "@/server/authz/permissions";

const exec: Actor = { id: "exec", role: Role.EXECUTIVE, status: "ACTIVE" };
const staff: Actor = { id: "staff", role: Role.STAFF, status: "ACTIVE" };
const pending = { status: ApprovalStatus.PENDING, requestedByUserId: null };

describe("requiredRoleFor", () => {
  it("needs an executive for every restricted type, at any risk", () => {
    for (const type of RESTRICTED_APPROVAL_TYPES) {
      for (const risk of Object.values(RiskLevel))
        expect(requiredRoleFor(type, risk)).toBe(Role.EXECUTIVE);
    }
  });

  it("needs an executive for high or critical risk content", () => {
    for (const type of [
      ApprovalType.SOCIAL_POST,
      ApprovalType.EMAIL,
      ApprovalType.DIRECT_MESSAGE,
    ]) {
      expect(requiredRoleFor(type, RiskLevel.HIGH)).toBe(Role.EXECUTIVE);
      expect(requiredRoleFor(type, RiskLevel.CRITICAL)).toBe(Role.EXECUTIVE);
      expect(requiredRoleFor(type, RiskLevel.LOW)).toBe(Role.STAFF);
      expect(requiredRoleFor(type, RiskLevel.MEDIUM)).toBe(Role.STAFF);
    }
  });

  it("treats spend, payments, site changes and launches as restricted", () => {
    expect(RESTRICTED_APPROVAL_TYPES).toEqual(
      expect.arrayContaining([
        ApprovalType.SPEND,
        ApprovalType.PAYMENT,
        ApprovalType.SITE_CHANGE,
        ApprovalType.LEGAL,
        ApprovalType.PROJECT_LAUNCH,
        ApprovalType.OUTSIDE_WORK,
      ]),
    );
  });
});

describe("canDecideApproval", () => {
  it("lets staff decide standard requests", () => {
    expect(canDecideApproval(staff, { ...pending, requiredRole: Role.STAFF })).toEqual({
      ok: true,
    });
  });

  it("stops staff deciding executive-level requests", () => {
    expect(canDecideApproval(staff, { ...pending, requiredRole: Role.EXECUTIVE }).ok).toBe(false);
    expect(canDecideApproval(exec, { ...pending, requiredRole: Role.EXECUTIVE })).toEqual({
      ok: true,
    });
  });

  it("stops reps and the system admin deciding anything", () => {
    for (const role of [Role.PREMIUM_REP, Role.FREE_REP, Role.SYSTEM_ADMIN]) {
      expect(
        canDecideApproval({ id: "x", role }, { ...pending, requiredRole: Role.STAFF }).ok,
      ).toBe(false);
    }
  });

  it("stops anyone approving their own request", () => {
    expect(
      canDecideApproval(exec, { ...pending, requiredRole: Role.STAFF, requestedByUserId: exec.id })
        .ok,
    ).toBe(false);
  });

  it("refuses already-decided requests", () => {
    for (const status of [
      ApprovalStatus.APPROVED,
      ApprovalStatus.REJECTED,
      ApprovalStatus.WITHDRAWN,
    ]) {
      expect(
        canDecideApproval(exec, { status, requiredRole: Role.STAFF, requestedByUserId: null }).ok,
      ).toBe(false);
    }
  });

  it("refuses suspended users", () => {
    expect(
      canDecideApproval({ ...exec, status: "SUSPENDED" }, { ...pending, requiredRole: Role.STAFF })
        .ok,
    ).toBe(false);
  });
});
