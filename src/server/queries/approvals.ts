import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ApprovalStatus, ApprovalType, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

export type ApprovalTab = "pending" | "approved" | "rejected" | "all";

/**
 * Legal approvals, and anything raised by a confidential department's agent
 * (Finance, Legal, HR), are executive-only. Applied in the database query so
 * the data never reaches a non-executive's browser.
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

const TAB_STATUS: Record<Exclude<ApprovalTab, "all">, ApprovalStatus[]> = {
  pending: [ApprovalStatus.PENDING],
  approved: [ApprovalStatus.APPROVED],
  rejected: [ApprovalStatus.REJECTED, ApprovalStatus.WITHDRAWN, ApprovalStatus.CHANGES_REQUESTED],
};

export async function listApprovals(role: Role, tab: ApprovalTab) {
  const visible = approvalVisibilityWhere(role);
  const where: Prisma.ApprovalRequestWhereInput =
    tab === "all" ? visible : { AND: [visible, { status: { in: TAB_STATUS[tab] } }] };

  const [items, counts] = await Promise.all([
    db.approvalRequest.findMany({
      where,
      orderBy:
        tab === "pending" ? [{ createdAt: "asc" }] : [{ decidedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        requestedByAgent: { select: { name: true, title: true } },
        decidedBy: { select: { name: true } },
        contentItem: { select: { channel: true, status: true } },
        complianceChecks: { orderBy: { checkedAt: "desc" }, take: 1, select: { outcome: true } },
      },
    }),
    db.approvalRequest.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
  ]);

  const count = (statuses: ApprovalStatus[]) =>
    counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0);

  return {
    items,
    counts: {
      pending: count(TAB_STATUS.pending),
      approved: count(TAB_STATUS.approved),
      rejected: count(TAB_STATUS.rejected),
      all: count(Object.values(ApprovalStatus)),
    },
  };
}

export async function getApprovalDetail(role: Role, id: string) {
  const request = await db.approvalRequest.findFirst({
    where: { AND: [{ id }, approvalVisibilityWhere(role)] },
    include: {
      requestedByAgent: {
        select: { id: true, name: true, title: true, owner: { select: { name: true } } },
      },
      requestedByUser: { select: { name: true } },
      decidedBy: { select: { name: true } },
      editedBy: { select: { name: true } },
      contentItem: { select: { id: true, status: true, channel: true, taskId: true } },
      budget: { select: { name: true } },
      complianceChecks: { orderBy: { checkedAt: "desc" } },
    },
  });
  if (!request) return null;

  const trailWhere: Prisma.AuditLogWhereInput[] = [{ entityType: "ApprovalRequest", entityId: id }];
  if (request.correlationId) trailWhere.push({ correlationId: request.correlationId });
  if (request.contentItem)
    trailWhere.push({ entityType: "ContentItem", entityId: request.contentItem.id });

  const trail = await db.auditLog.findMany({
    where: { OR: trailWhere },
    orderBy: { createdAt: "asc" },
    include: { actorUser: { select: { name: true } } },
  });
  const agentIds = [...new Set(trail.map((t) => t.actorAgentId).filter((x): x is string => !!x))];
  const agents = await db.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, title: true },
  });
  const agentName = new Map(agents.map((a) => [a.id, `${a.name} (${a.title})`]));

  return {
    request,
    trail: trail.map((t) => ({
      id: t.id,
      action: t.action,
      createdAt: t.createdAt,
      actor:
        t.actorType === "USER"
          ? (t.actorUser?.name ?? "A user")
          : t.actorType === "AGENT"
            ? (agentName.get(t.actorAgentId ?? "") ?? "An agent")
            : "System",
      actorType: t.actorType,
      metadata: t.metadata,
    })),
  };
}

export type ApprovalDetail = NonNullable<Awaited<ReturnType<typeof getApprovalDetail>>>;
