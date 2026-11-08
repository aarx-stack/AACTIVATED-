/**
 * Single source of truth for role-based access.
 *
 * Every server action, route handler and protected page calls `authorize()` /
 * `can()` with one of these permissions. The Admin page renders this same table
 * as the permission matrix, and tests/unit/authz.test.ts asserts every cell.
 *
 * This module is pure (no DB, no Next.js) so it can be imported anywhere.
 */
import { Role } from "@/generated/prisma/enums";

const { EXECUTIVE, STAFF, PREMIUM_REP, FREE_REP, SYSTEM_ADMIN } = Role;
const ALL_ROLES = [EXECUTIVE, STAFF, PREMIUM_REP, FREE_REP, SYSTEM_ADMIN] as const;
const COMPANY = [EXECUTIVE, STAFF, SYSTEM_ADMIN] as const;

export type PermissionGroup =
  | "Brain"
  | "Agents"
  | "Rep tools"
  | "Approvals"
  | "Finance"
  | "Knowledge"
  | "Confidential"
  | "Platform";

interface PermissionDef {
  label: string;
  group: PermissionGroup;
  roles: readonly Role[];
}

export const PERMISSIONS = {
  "command_center.view": { label: "View Brain Command Center", group: "Brain", roles: COMPANY },
  "brain.ask": { label: "Ask the Brain", group: "Brain", roles: [EXECUTIVE, STAFF] },
  "workflow.request": {
    label: "Give the Brain work (start workflows)",
    group: "Brain",
    roles: [EXECUTIVE, STAFF],
  },
  "company_team.view": { label: "View Company Team", group: "Agents", roles: COMPANY },
  "agent.view": { label: "Open agent workspaces", group: "Agents", roles: [EXECUTIVE, STAFF] },
  "agent.manage": {
    label: "Pause, resume and configure agents",
    group: "Agents",
    roles: [EXECUTIVE],
  },
  "rep_pod.full": { label: "Full 4-agent AI team", group: "Rep tools", roles: [PREMIUM_REP] },
  "rep_pod.coach": {
    label: "Business Coach agent",
    group: "Rep tools",
    roles: [PREMIUM_REP, FREE_REP],
  },
  "back_office.view_own": {
    label: "Own earnings & back office",
    group: "Rep tools",
    roles: [PREMIUM_REP, FREE_REP],
  },
  "content_studio.view": {
    label: "Content Studio",
    group: "Rep tools",
    roles: [EXECUTIVE, STAFF, PREMIUM_REP],
  },
  "content.create": {
    label: "Draft posts and request content",
    group: "Rep tools",
    roles: [EXECUTIVE, STAFF, PREMIUM_REP],
  },
  "content.schedule": {
    label: "Schedule approved posts",
    group: "Rep tools",
    roles: [EXECUTIVE, STAFF, PREMIUM_REP],
  },
  "leads.manage_own": {
    label: "Consented contacts and follow-ups",
    group: "Rep tools",
    roles: [PREMIUM_REP],
  },
  "approvals.view": { label: "View Approval Queue", group: "Approvals", roles: [EXECUTIVE, STAFF] },
  "approvals.decide_standard": {
    label: "Decide low/medium-risk content",
    group: "Approvals",
    roles: [EXECUTIVE, STAFF],
  },
  "approvals.decide_restricted": {
    label: "Decide spend, legal, launches, high risk",
    group: "Approvals",
    roles: [EXECUTIVE],
  },
  "compliance_rules.manage": {
    label: "Edit content compliance rules",
    group: "Approvals",
    roles: [EXECUTIVE],
  },
  "finance.view": { label: "Finance & Budget", group: "Finance", roles: [EXECUTIVE] },
  "budget.manage": { label: "Create and change budgets", group: "Finance", roles: [EXECUTIVE] },
  "budget.request_change": {
    label: "See budgets and request limit changes",
    group: "Finance",
    roles: [EXECUTIVE, STAFF],
  },
  "knowledge.view": { label: "Knowledge Library", group: "Knowledge", roles: ALL_ROLES },
  "knowledge.manage": {
    label: "Add documents and refresh AI summaries",
    group: "Knowledge",
    roles: [EXECUTIVE, STAFF],
  },
  "prompts.use": { label: "Prompt Generator", group: "Knowledge", roles: [EXECUTIVE, STAFF] },
  "confidential.legal": { label: "Legal records", group: "Confidential", roles: [EXECUTIVE] },
  "confidential.accounting": {
    label: "Corporate accounting",
    group: "Confidential",
    roles: [EXECUTIVE],
  },
  "confidential.hr": { label: "HR records", group: "Confidential", roles: [EXECUTIVE] },
  "roadmap.view": { label: "Development & Tokenization Map", group: "Platform", roles: COMPANY },
  "roadmap.manage": {
    label: "Add ideas and move projects on the map",
    group: "Platform",
    roles: [EXECUTIVE, STAFF],
  },
  "roadmap.approve_launch": {
    label: "Unlock and launch projects",
    group: "Platform",
    roles: [EXECUTIVE],
  },
  "admin.view": {
    label: "Admin & Access Control",
    group: "Platform",
    roles: [EXECUTIVE, SYSTEM_ADMIN],
  },
  "users.manage": {
    label: "Invite users and change roles",
    group: "Platform",
    roles: [EXECUTIVE, SYSTEM_ADMIN],
  },
  "integrations.manage": {
    label: "Configure integrations",
    group: "Platform",
    roles: [SYSTEM_ADMIN],
  },
  "integrations.connect_accounting": {
    label: "Connect or disconnect QuickBooks",
    group: "Platform",
    roles: [EXECUTIVE, SYSTEM_ADMIN],
  },
  "audit_log.view": {
    label: "Read the audit log",
    group: "Platform",
    roles: [EXECUTIVE, SYSTEM_ADMIN],
  },
  "system_status.view": { label: "System status", group: "Platform", roles: COMPANY },
  "account.manage_own": {
    label: "Own settings and notifications",
    group: "Platform",
    roles: ALL_ROLES,
  },
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const ROLE_ORDER: readonly Role[] = ALL_ROLES;

export const ROLE_LABELS: Record<Role, string> = {
  EXECUTIVE: "Executive",
  STAFF: "Staff",
  PREMIUM_REP: "Premium Rep",
  FREE_REP: "Free Rep",
  SYSTEM_ADMIN: "System Admin",
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission].roles as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return ALL_PERMISSIONS.filter((p) => can(role, p));
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have access to this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super("Sign in required.");
    this.name = "UnauthenticatedError";
  }
}

export interface Actor {
  id: string;
  role: Role;
  status?: "INVITED" | "ACTIVE" | "SUSPENDED";
}

/** Throws unless the actor is signed in, active, and holds the permission. */
export function authorize(
  actor: Actor | null | undefined,
  permission: Permission,
): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.status === "SUSPENDED") throw new ForbiddenError("This account is suspended.");
  if (!can(actor.role, permission)) throw new ForbiddenError();
}
