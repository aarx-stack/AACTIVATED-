import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ApprovalType, Role } from "@/generated/prisma/enums";
import { ApprovalStatus, type RiskLevel } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

export type ApprovalTab = "pending" | "approved" | "rejected" | "all";

/**
 * Legal approvals, and anything raised by a confidential department's agent
 * (Finance, Legal, HR), are executive-only. Applied in the database query so
 * the data never reaches a non-executive's browser.
 */
export { approvalVisibilityWhere } from "@/server/approvals/visibility";
import { approvalVisibilityWhere } from "@/server/approvals/visibility";

const TAB_STATUS: Record<Exclude<ApprovalTab, "all">, ApprovalStatus[]> = {
  pending: [ApprovalStatus.PENDING],
  approved: [ApprovalStatus.APPROVED],
  rejected: [ApprovalStatus.REJECTED, ApprovalStatus.WITHDRAWN, ApprovalStatus.CHANGES_REQUESTED],
};

export interface ApprovalFilters {
  tab: ApprovalTab;
  q?: string;
  type?: ApprovalType;
  risk?: RiskLevel;
}

const DAY = 86_400_000;

export async function listApprovals(role: Role, filters: ApprovalFilters, now = new Date()) {
  const visible = approvalVisibilityWhere(role);
  const conditions: Prisma.ApprovalRequestWhereInput[] = [visible];
  if (filters.tab !== "all") conditions.push({ status: { in: TAB_STATUS[filters.tab] } });
  if (filters.type) conditions.push({ type: filters.type });
  if (filters.risk) conditions.push({ risk: filters.risk });
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    conditions.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
        { requestedByAgent: { title: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const weekAgo = new Date(now.getTime() - 7 * DAY);

  const [items, counts, approved7d, rejected7d, decided7d] = await Promise.all([
    db.approvalRequest.findMany({
      where: { AND: conditions },
      orderBy:
        filters.tab === "pending"
          ? [{ createdAt: "asc" }]
          : [{ decidedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        requestedByAgent: {
          select: { name: true, title: true, department: { select: { name: true } } },
        },
        requestedByUser: { select: { name: true } },
        decidedBy: { select: { name: true } },
        contentItem: { select: { channel: true, status: true } },
        complianceChecks: { orderBy: { checkedAt: "desc" }, take: 1, select: { outcome: true } },
      },
    }),
    db.approvalRequest.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
    db.approvalRequest.count({
      where: { AND: [visible, { status: ApprovalStatus.APPROVED, decidedAt: { gte: weekAgo } }] },
    }),
    db.approvalRequest.count({
      where: { AND: [visible, { status: ApprovalStatus.REJECTED, decidedAt: { gte: weekAgo } }] },
    }),
    db.approvalRequest.findMany({
      where: { AND: [visible, { decidedAt: { gte: weekAgo } }] },
      select: { createdAt: true, decidedAt: true },
    }),
  ]);

  const count = (statuses: ApprovalStatus[]) =>
    counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
  const reviewMinutes = decided7d.map(
    (d) => (d.decidedAt!.getTime() - d.createdAt.getTime()) / 60_000,
  );
  const avgReviewMinutes = reviewMinutes.length
    ? reviewMinutes.reduce((n, m) => n + m, 0) / reviewMinutes.length
    : null;

  return {
    items,
    counts: {
      pending: count(TAB_STATUS.pending),
      approved: count(TAB_STATUS.approved),
      rejected: count(TAB_STATUS.rejected),
      all: count(Object.values(ApprovalStatus)),
    },
    stats: { approved7d, rejected7d, avgReviewMinutes },
  };
}

export type ApprovalListItem = Awaited<ReturnType<typeof listApprovals>>["items"][number];

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
  const { approvalOriginatorId } = await import("@/server/approvals/service");
  const originatorUserId = await approvalOriginatorId(db, request.correlationId);

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
    request: { ...request, originatorUserId },
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
