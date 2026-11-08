/**
 * Budget limit changes through the Approval Queue.
 *
 *   listBudgetsForRequests()  staff and executives see each current budget's name, limit and how
 *                             much is used: no transactions, no revenue, and no budgets of
 *                             confidential departments unless they are an executive
 *   requestLimitChange()      staff ask for a new limit with a reason; it becomes an executive
 *                             approval request (one open request per budget)
 *   applyBudgetChange()       called by decideApproval: an approved change sets the limit, only
 *                             if the limit is still what it was when the request was made
 *
 * Executives still change a limit directly in Finance & Budget, with a note (setBudgetLimit).
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import {
  ApprovalStatus,
  ApprovalType,
  NotificationKind,
  RiskLevel,
  Role,
} from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { formatUsd } from "@/lib/utils";
import { recordAudit } from "@/server/audit/audit";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { notifyUser } from "@/server/notifications";
import { BudgetChangePendingError } from "./errors";
import { budgetState } from "./rules";
import { budgetFigures, refreshBudget } from "./service";

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const toCents = (n: number) => Math.round(n * 100);

export interface BudgetChangePayload {
  budgetId: string;
  fromLimitUsd: number;
  toLimitUsd: number;
}

export function readBudgetChange(payload: unknown): BudgetChangePayload | null {
  const p = payload as Partial<BudgetChangePayload> | null;
  return p &&
    typeof p.budgetId === "string" &&
    typeof p.fromLimitUsd === "number" &&
    typeof p.toLimitUsd === "number"
    ? { budgetId: p.budgetId, fromLimitUsd: p.fromLimitUsd, toLimitUsd: p.toLimitUsd }
    : null;
}

function visibleTo(role: Role, budget: { department: { isConfidential: boolean } | null }) {
  return role === Role.EXECUTIVE || !budget.department?.isConfidential;
}

export async function listBudgetsForRequests(actor: Actor, client: Db = db, now = new Date()) {
  authorize(actor, "budget.request_change");
  const budgets = await client.budget.findMany({
    where: { periodStart: { lte: now }, periodEnd: { gte: now } },
    orderBy: { name: "asc" },
    include: { department: { select: { name: true, isConfidential: true } } },
  });
  const visible = budgets.filter((b) => visibleTo(actor.role, b));
  const pending = await client.approvalRequest.findMany({
    where: {
      type: ApprovalType.BUDGET_CHANGE,
      status: ApprovalStatus.PENDING,
      budgetId: { in: visible.map((b) => b.id) },
    },
    select: {
      id: true,
      budgetId: true,
      payload: true,
      requestedByUser: { select: { name: true } },
    },
  });
  return Promise.all(
    visible.map(async (b) => {
      const figures = await budgetFigures(client, b);
      const state = budgetState(figures);
      const open = pending.find((p) => p.budgetId === b.id);
      return {
        id: b.id,
        name: b.name,
        department: b.department?.name ?? "Company-wide",
        periodEnd: b.periodEnd,
        limitUsd: figures.limitUsd,
        spentUsd: figures.spentUsd,
        ratio: state.ratio,
        status: state.status,
        locked: state.locked,
        pendingChange: open
          ? {
              id: open.id,
              toLimitUsd: readBudgetChange(open.payload)?.toLimitUsd ?? null,
              requestedBy: open.requestedByUser?.name ?? null,
            }
          : null,
      };
    }),
  );
}

export const changeRequestSchema = z.object({
  budgetId: z.string().min(1),
  limitUsd: z.coerce
    .number({ message: "Enter the new limit." })
    .positive("The limit must be above zero.")
    .max(10_000_000, "That limit is too large."),
  reason: z.string().trim().min(10, "Explain in a sentence why the limit should change.").max(500),
});

/** Staff ask for a new limit. The request waits in the Approval Queue for an executive. */
export async function requestLimitChange(
  actor: Actor & { name?: string | null },
  input: z.input<typeof changeRequestSchema>,
  client: Db = db,
) {
  authorize(actor, "budget.request_change");
  if (actor.role === Role.EXECUTIVE) {
    throw new ForbiddenError("Executives change limits directly in Finance & Budget.");
  }
  const data = changeRequestSchema.parse(input);
  const { submitApproval } = await import("@/server/approvals/service");

  return client.$transaction(async (tx) => {
    const budget = await tx.budget.findUnique({
      where: { id: data.budgetId },
      include: { department: { select: { name: true, isConfidential: true } } },
    });
    if (!budget || !visibleTo(actor.role, budget)) {
      throw new ForbiddenError("That budget is not available to you.");
    }
    const from = num(budget.limitUsd);
    const to = Math.round(data.limitUsd * 100) / 100;
    if (toCents(from) === toCents(to)) throw new ForbiddenError("That is already the limit.");

    const open = await tx.approvalRequest.findFirst({
      where: {
        budgetId: budget.id,
        type: ApprovalType.BUDGET_CHANGE,
        status: ApprovalStatus.PENDING,
      },
      select: { id: true },
    });
    if (open) {
      throw new BudgetChangePendingError(
        `A limit change for ${budget.name} is already waiting for an executive.`,
        open.id,
      );
    }

    const figures = await budgetFigures(tx, budget);
    const raise = to > from;
    const payload: BudgetChangePayload = {
      budgetId: budget.id,
      fromLimitUsd: from,
      toLimitUsd: to,
    };
    return submitApproval(tx, {
      type: ApprovalType.BUDGET_CHANGE,
      title: `Budget: ${budget.name} limit ${formatUsd(from)} to ${formatUsd(to)}`,
      summary: `${raise ? "Raise" : "Lower"} the ${budget.name} limit from ${formatUsd(from)} to ${formatUsd(to)}. ${formatUsd(figures.spentUsd)} is used so far this period.`,
      payload: payload as unknown as Record<string, unknown>,
      reasoning: `${actor.name ?? "A team member"} asked for this change: ${data.reason}`,
      sources: [
        {
          title: `${budget.name} (${budget.department?.name ?? "Company-wide"})`,
          note: `${formatUsd(figures.spentUsd)} of ${formatUsd(from)} used this period.`,
        },
      ],
      risk: raise && to > from * 1.5 ? RiskLevel.MEDIUM : RiskLevel.LOW,
      requestedByUserId: actor.id,
      budgetId: budget.id,
    });
  });
}

/**
 * Applies an executive's decision on a limit change, inside decideApproval's transaction.
 * The limit must still be the one the request was made against; otherwise the decision is
 * refused (nothing changes) and the person is asked to look again.
 */
export async function applyBudgetChange(
  tx: DbClient,
  request: { id: string; title: string; payload: unknown; requestedByUserId: string | null },
  decision: "APPROVE" | "REJECT",
  actorId: string,
  note: string | null,
) {
  const change = readBudgetChange(request.payload);
  if (!change) throw new ForbiddenError("This request does not describe a budget change.");

  if (decision === "APPROVE") {
    const budget = await tx.budget.findUnique({ where: { id: change.budgetId } });
    if (!budget) throw new ForbiddenError("That budget no longer exists.");
    if (toCents(num(budget.limitUsd)) !== toCents(change.fromLimitUsd)) {
      const { ApprovalConflictError } = await import("@/server/approvals/service");
      throw new ApprovalConflictError(
        `The ${budget.name} limit changed to ${formatUsd(num(budget.limitUsd))} after this request was made. Reject it and ask for a new request.`,
      );
    }
    await tx.budget.update({
      where: { id: budget.id },
      data: { limitUsd: new Prisma.Decimal(change.toLimitUsd.toFixed(2)) },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actorId },
      action: "budget.limit_changed",
      entityType: "Budget",
      entityId: budget.id,
      before: { limitUsd: change.fromLimitUsd },
      after: { limitUsd: change.toLimitUsd },
      metadata: { approvalRequestId: request.id, note },
    });
    await refreshBudget(tx, budget.id);
  }

  await notifyUser(tx, request.requestedByUserId, {
    kind: NotificationKind.APPROVAL_DECIDED,
    title: decision === "APPROVE" ? `Approved: ${request.title}` : `Rejected: ${request.title}`,
    body:
      decision === "APPROVE"
        ? `The new limit of ${formatUsd(change.toLimitUsd)} is in effect.`
        : (note ?? "Rejected."),
    href: "/budgets",
  });
}
