import type { Prisma } from "@/generated/prisma/client";
import { ApprovalType, Role } from "@/generated/prisma/enums";

/**
 * Which approval requests a role may see at all: legal requests and anything from a confidential
 * department's agents are executive-only. Applied to lists, detail pages and decisions alike.
 */
export function approvalVisibilityWhere(role: Role): Prisma.ApprovalRequestWhereInput {
  if (role === Role.EXECUTIVE) return {};
  return {
    type: { not: ApprovalType.LEGAL },
    OR: [
      { requestedByAgentId: null },
      { requestedByAgent: { department: null } },
      { requestedByAgent: { department: { isConfidential: false } } },
    ],
  };
}
