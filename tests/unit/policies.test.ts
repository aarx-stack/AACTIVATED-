import { describe, expect, it } from "vitest";
import { AccessLevel, Role } from "@/generated/prisma/enums";
import type { Actor } from "@/server/authz/permissions";
import {
  canChangeRole,
  canChangeUserStatus,
  canOpenAgentWorkspace,
  canReadDocument,
  canViewDepartmentDetail,
  readableAccessLevels,
} from "@/server/authz/policies";

const exec: Actor = { id: "exec", role: Role.EXECUTIVE, status: "ACTIVE" };
const exec2 = { id: "exec2", role: Role.EXECUTIVE };
const admin: Actor = { id: "admin", role: Role.SYSTEM_ADMIN, status: "ACTIVE" };
const staff: Actor = { id: "staff", role: Role.STAFF, status: "ACTIVE" };
const rep = { id: "rep", role: Role.PREMIUM_REP };

describe("documents", () => {
  it("restricts EXECUTIVE_ONLY documents to executives", () => {
    expect(canReadDocument(Role.EXECUTIVE, AccessLevel.EXECUTIVE_ONLY)).toBe(true);
    for (const r of [Role.STAFF, Role.SYSTEM_ADMIN, Role.PREMIUM_REP, Role.FREE_REP]) {
      expect(canReadDocument(r, AccessLevel.EXECUTIVE_ONLY)).toBe(false);
    }
  });

  it("limits ALL_STAFF documents to company roles", () => {
    expect(readableAccessLevels(Role.STAFF)).toEqual([
      AccessLevel.ALL_STAFF,
      AccessLevel.ALL_USERS,
    ]);
    expect(readableAccessLevels(Role.FREE_REP)).toEqual([AccessLevel.ALL_USERS]);
    expect(readableAccessLevels(Role.EXECUTIVE)).toHaveLength(3);
  });

  it("denies a missing role", () => {
    expect(canReadDocument(null, AccessLevel.ALL_USERS)).toBe(false);
  });
});

describe("confidential departments", () => {
  const legal = { isConfidential: true };
  const marketing = { isConfidential: false };

  it("shows confidential department detail to executives only", () => {
    expect(canViewDepartmentDetail(Role.EXECUTIVE, legal)).toBe(true);
    expect(canViewDepartmentDetail(Role.STAFF, legal)).toBe(false);
    expect(canViewDepartmentDetail(Role.SYSTEM_ADMIN, legal)).toBe(false);
    expect(canViewDepartmentDetail(Role.STAFF, marketing)).toBe(true);
    expect(canViewDepartmentDetail(Role.PREMIUM_REP, marketing)).toBe(false);
  });

  it("opens confidential agent workspaces for executives only", () => {
    expect(canOpenAgentWorkspace(Role.EXECUTIVE, { department: legal })).toBe(true);
    expect(canOpenAgentWorkspace(Role.STAFF, { department: legal })).toBe(false);
    expect(canOpenAgentWorkspace(Role.STAFF, { department: marketing })).toBe(true);
    expect(canOpenAgentWorkspace(Role.STAFF, { department: null })).toBe(true);
    expect(canOpenAgentWorkspace(Role.SYSTEM_ADMIN, { department: marketing })).toBe(false);
  });
});

describe("role changes", () => {
  it("lets an executive change any other user's role", () => {
    expect(canChangeRole(exec, rep, Role.STAFF)).toEqual({ ok: true });
    expect(canChangeRole(exec, exec2, Role.STAFF)).toEqual({ ok: true });
    expect(canChangeRole(exec, rep, Role.EXECUTIVE)).toEqual({ ok: true });
  });

  it("stops anyone changing their own role", () => {
    expect(canChangeRole(exec, exec, Role.STAFF).ok).toBe(false);
    expect(canChangeRole(admin, admin, Role.EXECUTIVE).ok).toBe(false);
  });

  it("stops a system admin granting or removing EXECUTIVE", () => {
    expect(canChangeRole(admin, rep, Role.EXECUTIVE).ok).toBe(false);
    expect(canChangeRole(admin, exec2, Role.STAFF).ok).toBe(false);
  });

  it("lets a system admin change non-executive roles", () => {
    expect(canChangeRole(admin, rep, Role.FREE_REP)).toEqual({ ok: true });
  });

  it("stops staff and reps managing users", () => {
    expect(canChangeRole(staff, rep, Role.FREE_REP).ok).toBe(false);
    expect(
      canChangeRole(
        { ...rep, status: "ACTIVE" },
        { id: "x", role: Role.FREE_REP },
        Role.PREMIUM_REP,
      ).ok,
    ).toBe(false);
  });

  it("rejects a no-op change and suspended actors", () => {
    expect(canChangeRole(exec, rep, Role.PREMIUM_REP).ok).toBe(false);
    expect(canChangeRole({ ...exec, status: "SUSPENDED" }, rep, Role.STAFF).ok).toBe(false);
  });
});

describe("status changes", () => {
  it("lets admins suspend non-executives but not executives", () => {
    expect(canChangeUserStatus(admin, rep)).toEqual({ ok: true });
    expect(canChangeUserStatus(admin, exec2).ok).toBe(false);
    expect(canChangeUserStatus(exec, exec2)).toEqual({ ok: true });
  });

  it("stops self-suspension and staff", () => {
    expect(canChangeUserStatus(exec, exec).ok).toBe(false);
    expect(canChangeUserStatus(staff, rep).ok).toBe(false);
  });
});
