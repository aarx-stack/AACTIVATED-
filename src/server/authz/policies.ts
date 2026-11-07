/**
 * Resource-level rules that go beyond a flat permission check.
 * Pure functions: callers load the records, these decide.
 */
import { AccessLevel, Role } from "@/generated/prisma/enums";
import { can, type Actor } from "./permissions";

export type Decision = { ok: true } | { ok: false; reason: string };
const allow: Decision = { ok: true };
const deny = (reason: string): Decision => ({ ok: false, reason });

// --- Documents ---------------------------------------------------------------

export function canReadDocument(role: Role | null | undefined, accessLevel: AccessLevel): boolean {
  if (!role) return false;
  switch (accessLevel) {
    case AccessLevel.EXECUTIVE_ONLY:
      return role === Role.EXECUTIVE;
    case AccessLevel.ALL_STAFF:
      return role === Role.EXECUTIVE || role === Role.STAFF || role === Role.SYSTEM_ADMIN;
    case AccessLevel.ALL_USERS:
      return true;
  }
}

/** Which access levels a role may see — use to build DB `where` filters so data never leaves the server. */
export function readableAccessLevels(role: Role): AccessLevel[] {
  return Object.values(AccessLevel).filter((level) => canReadDocument(role, level));
}

// --- Departments & agents ----------------------------------------------------

/** Confidential departments (Legal, Finance, HR) expose detail to executives only. */
export function canViewDepartmentDetail(
  role: Role | null | undefined,
  department: { isConfidential: boolean },
): boolean {
  if (!can(role, "company_team.view")) return false;
  return department.isConfidential ? role === Role.EXECUTIVE : true;
}

/**
 * Company agent workspaces. Confidential departments (Legal, Finance, HR) and
 * reps' private pod agents open for executives only.
 */
export function canOpenAgentWorkspace(
  role: Role | null | undefined,
  agent: { department: { isConfidential: boolean } | null; kind?: string },
): boolean {
  if (!can(role, "agent.view")) return false;
  if (agent.kind === "REP_POD") return role === Role.EXECUTIVE;
  if (agent.department?.isConfidential) return role === Role.EXECUTIVE;
  return true;
}

// --- User administration -----------------------------------------------------

/**
 * Role changes:
 *  - need `users.manage`
 *  - nobody changes their own role
 *  - only an EXECUTIVE can grant or revoke EXECUTIVE
 *  - a suspended actor can do nothing
 */
export function canChangeRole(
  actor: Actor,
  target: { id: string; role: Role },
  nextRole: Role,
): Decision {
  if (actor.status === "SUSPENDED") return deny("Your account is suspended.");
  if (!can(actor.role, "users.manage")) return deny("You cannot manage users.");
  if (actor.id === target.id) return deny("You cannot change your own role.");
  if (target.role === nextRole) return deny("That user already has this role.");
  const touchesExecutive = target.role === Role.EXECUTIVE || nextRole === Role.EXECUTIVE;
  if (touchesExecutive && actor.role !== Role.EXECUTIVE) {
    return deny("Only an executive can grant or remove the Executive role.");
  }
  return allow;
}

export function canChangeUserStatus(actor: Actor, target: { id: string; role: Role }): Decision {
  if (actor.status === "SUSPENDED") return deny("Your account is suspended.");
  if (!can(actor.role, "users.manage")) return deny("You cannot manage users.");
  if (actor.id === target.id) return deny("You cannot suspend or reactivate yourself.");
  if (target.role === Role.EXECUTIVE && actor.role !== Role.EXECUTIVE) {
    return deny("Only an executive can change an executive's status.");
  }
  return allow;
}
