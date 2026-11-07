/**
 * Approval policy — who may decide what. Pure and unit-tested.
 *
 * Tiered model (approved for Phase 1, configurable later from Admin):
 *  - Restricted types (spend, payments, site changes, legal, outside work, launches)
 *    and anything HIGH/CRITICAL risk need an EXECUTIVE.
 *  - Low/medium-risk content (posts, emails, DMs) can be decided by STAFF or EXECUTIVE.
 *  - Agents never decide. Nobody decides their own request.
 */
import { ApprovalStatus, ApprovalType, RiskLevel, Role } from "@/generated/prisma/enums";
import { can, type Actor } from "@/server/authz/permissions";
import type { Decision } from "@/server/authz/policies";

export const RESTRICTED_APPROVAL_TYPES: readonly ApprovalType[] = [
  ApprovalType.SPEND,
  ApprovalType.PAYMENT,
  ApprovalType.SITE_CHANGE,
  ApprovalType.LEGAL,
  ApprovalType.OUTSIDE_WORK,
  ApprovalType.PROJECT_LAUNCH,
];

const HIGH_RISK: readonly RiskLevel[] = [RiskLevel.HIGH, RiskLevel.CRITICAL];

export function requiredRoleFor(type: ApprovalType, risk: RiskLevel): Role {
  if (RESTRICTED_APPROVAL_TYPES.includes(type) || HIGH_RISK.includes(risk)) return Role.EXECUTIVE;
  return Role.STAFF;
}

export interface ApprovalForDecision {
  status: ApprovalStatus;
  requiredRole: Role;
  requestedByUserId: string | null;
}

export function canDecideApproval(actor: Actor, request: ApprovalForDecision): Decision {
  if (actor.status === "SUSPENDED") return { ok: false, reason: "Your account is suspended." };
  if (!can(actor.role, "approvals.decide_standard")) {
    return { ok: false, reason: "Your role cannot approve outbound items." };
  }
  if (request.status !== ApprovalStatus.PENDING) {
    return { ok: false, reason: "This request has already been decided." };
  }
  if (request.requestedByUserId && request.requestedByUserId === actor.id) {
    return { ok: false, reason: "You cannot approve your own request." };
  }
  if (request.requiredRole === Role.EXECUTIVE && !can(actor.role, "approvals.decide_restricted")) {
    return { ok: false, reason: "This request needs an executive decision." };
  }
  return { ok: true };
}
