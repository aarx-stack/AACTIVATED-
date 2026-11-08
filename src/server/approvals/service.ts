/**
 * Approval Queue service. Nothing leaves the building without passing through here:
 *   submitApproval()      agent or human puts an outbound item in the queue
 *   editApproval()        a reviewer edits it: compliance re-runs, the revision increments
 *   decideApproval()      a human approves or rejects (policy.ts decides who may)
 *   assertDispatchable()  the outbound gate: only an approved, unmodified payload can be sent
 * Every state change writes an AuditLog entry in the same transaction.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ApprovalType, RiskLevel } from "@/generated/prisma/enums";
import {
  ActivityKind,
  ApprovalStatus,
  type ContentChannel,
  ContentStatus,
  NotificationKind,
  TaskStatus,
} from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { recordAudit, type AuditActor } from "@/server/audit/audit";
import { type Actor, ForbiddenError } from "@/server/authz/permissions";
import { runComplianceCheck } from "@/server/compliance/service";
import { notifyApprovers, notifyUser } from "@/server/notifications";
import {
  hashPayload,
  isSocialPostPayload,
  type ApprovalSource,
  type SocialPostPayload,
} from "./payload";
import { canDecideApproval, requiredRoleFor } from "./policy";

export class ApprovalConflictError extends Error {
  readonly status = 409;
}

export class DispatchBlockedError extends Error {
  readonly status = 423;
}

// ------------------------------------------------------------------- submit --

export interface SubmitApprovalInput {
  type: ApprovalType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  reasoning: string;
  sources: ApprovalSource[];
  risk: RiskLevel;
  requestedByAgentId?: string | null;
  requestedByUserId?: string | null;
  contentItemId?: string | null;
  budgetId?: string | null;
  amountUsd?: number | null;
  correlationId?: string | null;
}

/** Call inside the caller's transaction. Reasoning and sources are mandatory: no bare approvals. */
export async function submitApproval(tx: DbClient, input: SubmitApprovalInput) {
  if (input.reasoning.trim().length < 10)
    throw new Error("Approval requests need the agent's reasoning.");
  if (input.sources.length === 0) throw new Error("Approval requests need at least one source.");

  const requiredRole = requiredRoleFor(input.type, input.risk);
  const request = await tx.approvalRequest.create({
    data: {
      type: input.type,
      title: input.title,
      summary: input.summary,
      payload: input.payload as Prisma.InputJsonValue,
      payloadHash: hashPayload(input.payload),
      reasoning: input.reasoning,
      sources: input.sources as unknown as Prisma.InputJsonValue,
      risk: input.risk,
      requiredRole,
      requestedByAgentId: input.requestedByAgentId ?? null,
      requestedByUserId: input.requestedByUserId ?? null,
      contentItemId: input.contentItemId ?? null,
      budgetId: input.budgetId ?? null,
      amountUsd: input.amountUsd != null ? new Prisma.Decimal(input.amountUsd.toFixed(2)) : null,
      correlationId: input.correlationId ?? null,
    },
  });

  const actor: AuditActor = input.requestedByAgentId
    ? { type: "AGENT", agentId: input.requestedByAgentId }
    : input.requestedByUserId
      ? { type: "USER", userId: input.requestedByUserId }
      : { type: "SYSTEM" };
  await recordAudit(tx, {
    actor,
    action: "approval.requested",
    entityType: "ApprovalRequest",
    entityId: request.id,
    correlationId: input.correlationId,
    after: {
      type: request.type,
      risk: request.risk,
      requiredRole,
      payloadHash: request.payloadHash,
    },
  });
  await notifyApprovers(tx, requiredRole, {
    title:
      requiredRole === "EXECUTIVE"
        ? `Executive decision needed: ${input.title}`
        : `Review requested: ${input.title}`,
    body: input.summary,
    href: `/approvals/${request.id}`,
    kind:
      input.risk === "HIGH" || input.risk === "CRITICAL"
        ? NotificationKind.COMPLIANCE_FLAG
        : NotificationKind.APPROVAL_REQUESTED,
  });
  return request;
}

// ------------------------------------------------------------------- decide --

export const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(1000).optional(),
});

const MIN_REJECT_NOTE = 3;
const MIN_OVERRIDE_NOTE = 10;

export async function decideApproval(
  actor: Actor,
  approvalId: string,
  input: z.input<typeof decisionSchema>,
  client: Db = db,
) {
  const { decision, note } = decisionSchema.parse(input);

  return client.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        complianceChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
        contentItem: {
          select: { id: true, taskId: true, task: { select: { createdById: true } } },
        },
      },
    });
    if (!request) throw new ApprovalConflictError("Approval request not found.");

    const allowed = canDecideApproval(actor, request);
    if (!allowed.ok) throw new ForbiddenError(allowed.reason);

    const latestCheck = request.complianceChecks[0];
    if (decision === "REJECT" && (note?.length ?? 0) < MIN_REJECT_NOTE) {
      throw new ForbiddenError("Add a short note explaining the rejection.");
    }
    if (
      decision === "APPROVE" &&
      latestCheck?.outcome === "FAIL" &&
      (note?.length ?? 0) < MIN_OVERRIDE_NOTE
    ) {
      throw new ForbiddenError(
        "This item failed the compliance check. Edit it, or add a note acknowledging the findings to approve anyway.",
      );
    }

    const status = decision === "APPROVE" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    // Guarded update: if someone else decided first, nothing changes.
    const updated = await tx.approvalRequest.updateMany({
      where: { id: approvalId, status: ApprovalStatus.PENDING, payloadHash: request.payloadHash },
      data: { status, decidedById: actor.id, decidedAt: new Date(), decisionNote: note ?? null },
    });
    if (updated.count !== 1)
      throw new ApprovalConflictError(
        "This request changed or was already decided. Reload and try again.",
      );

    const audit = (
      action: string,
      entityType: string,
      entityId: string | null,
      extra?: { before?: unknown; after?: unknown; metadata?: unknown },
    ) =>
      recordAudit(tx, {
        actor: { type: "USER", userId: actor.id },
        action,
        entityType,
        entityId,
        correlationId: request.correlationId,
        ...extra,
      });

    await audit(
      decision === "APPROVE" ? "approval.approved" : "approval.rejected",
      "ApprovalRequest",
      request.id,
      {
        before: { status: request.status },
        after: { status },
        metadata: {
          note: note ?? null,
          payloadHash: request.payloadHash,
          revision: request.revision,
          complianceOutcome: latestCheck?.outcome ?? null,
          overrodeCompliance: decision === "APPROVE" && latestCheck?.outcome === "FAIL",
        },
      },
    );

    const content = request.contentItem;
    if (content) {
      const contentStatus =
        decision === "APPROVE" ? ContentStatus.APPROVED : ContentStatus.REJECTED;
      await tx.contentItem.update({ where: { id: content.id }, data: { status: contentStatus } });
      await audit(
        decision === "APPROVE" ? "content.ready_to_schedule" : "content.rejected",
        "ContentItem",
        content.id,
        { after: { status: contentStatus } },
      );
      if (content.taskId) {
        const taskStatus = decision === "APPROVE" ? TaskStatus.DONE : TaskStatus.CANCELLED;
        await tx.task.update({
          where: { id: content.taskId },
          data: { status: taskStatus, completedAt: decision === "APPROVE" ? new Date() : null },
        });
        // Close the parent request task too.
        await tx.task.updateMany({
          where: { subtasks: { some: { id: content.taskId } } },
          data: { status: taskStatus, completedAt: decision === "APPROVE" ? new Date() : null },
        });
      }
      await notifyUser(tx, content.task?.createdById, {
        kind: NotificationKind.APPROVAL_DECIDED,
        title: decision === "APPROVE" ? `Approved: ${request.title}` : `Rejected: ${request.title}`,
        body: decision === "APPROVE" ? "Approved and ready to schedule." : (note ?? "Rejected."),
        href: `/content/${content.id}`,
      });
    } else if (request.correlationId) {
      // Non-content requests (e.g. a rep's follow-up message): close the task and tell whoever asked.
      const origin = await tx.task.findFirst({
        where: { correlationId: request.correlationId, parentId: null },
        select: { id: true, createdById: true },
      });
      if (origin) {
        await tx.task.update({
          where: { id: origin.id },
          data:
            decision === "APPROVE"
              ? { status: TaskStatus.DONE, completedAt: new Date() }
              : { status: TaskStatus.CANCELLED },
        });
        await notifyUser(tx, origin.createdById, {
          kind: NotificationKind.APPROVAL_DECIDED,
          title:
            decision === "APPROVE" ? `Approved: ${request.title}` : `Rejected: ${request.title}`,
          body:
            decision === "APPROVE"
              ? "Approved. You can send it from My AI Team."
              : (note ?? "Rejected."),
          href: "/my-team",
        });
      }
    }

    // Approved spend changes what the budget allows: recompute it (may lift a pause).
    if (request.budgetId && decision === "APPROVE") {
      const { refreshBudget } = await import("@/server/budgets/service");
      await refreshBudget(tx, request.budgetId);
    }

    if (request.requestedByAgentId) {
      const isSpend = request.type === "SPEND";
      await tx.agentActivity.create({
        data: {
          agentId: request.requestedByAgentId,
          kind: decision === "APPROVE" ? ActivityKind.COMPLETED : ActivityKind.FLAGGED,
          message:
            decision === "APPROVE"
              ? isSpend
                ? `"${request.title}" was approved and can be recorded.`
                : `"${request.title}" was approved and is ready to schedule.`
              : `"${request.title}" was rejected by a reviewer.`,
          taskId: content?.taskId ?? null,
        },
      });
    }

    return tx.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
  });
}

// --------------------------------------------------------------------- edit --

export const editSchema = z.object({
  title: z.string().trim().min(3).max(120),
  caption: z.string().trim().min(10, "The caption is too short.").max(2200),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .regex(/^#[\p{L}\p{N}_]+$/u, "Hashtags start with # and have no spaces."),
    )
    .max(10),
});

/** A reviewer edits the outbound content. Compliance re-runs and the approval gets a new revision. */
export async function editApproval(
  actor: Actor,
  approvalId: string,
  input: z.input<typeof editSchema>,
  client: Db = db,
) {
  const data = editSchema.parse(input);
  return client.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!request) throw new ApprovalConflictError("Approval request not found.");
    // Anyone who may decide at the standard level may propose an edit; the decision rules still apply afterwards.
    const allowed = canDecideApproval(actor, { ...request, requiredRole: "STAFF" });
    if (!allowed.ok) throw new ForbiddenError(allowed.reason);
    const before = request.payload;
    if (!isSocialPostPayload(before))
      throw new ForbiddenError("This request type cannot be edited here.");

    const payload: SocialPostPayload = {
      channel: before.channel,
      title: data.title,
      caption: data.caption,
      hashtags: data.hashtags,
    };
    const text = `${data.title}\n${data.caption}\n${data.hashtags.join(" ")}`;
    const check = await runComplianceCheck(tx, {
      text,
      channel: before.channel as ContentChannel,
      approvalRequestId: request.id,
      contentItemId: request.contentItemId,
    });
    const requiredRole = requiredRoleFor(request.type, check.risk);
    const payloadHash = hashPayload(payload);

    const updated = await tx.approvalRequest.updateMany({
      where: { id: approvalId, status: ApprovalStatus.PENDING, revision: request.revision },
      data: {
        payload: payload as unknown as Prisma.InputJsonValue,
        payloadHash,
        risk: check.risk,
        requiredRole,
        revision: { increment: 1 },
        editedById: actor.id,
        editedAt: new Date(),
      },
    });
    if (updated.count !== 1)
      throw new ApprovalConflictError("Someone else changed this request. Reload and try again.");

    if (request.contentItemId) {
      await tx.contentItem.update({
        where: { id: request.contentItemId },
        data: { title: data.title, body: data.caption },
      });
    }
    const correlationId = request.correlationId;
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "approval.edited",
      entityType: "ApprovalRequest",
      entityId: request.id,
      correlationId,
      before: {
        payload: before,
        payloadHash: request.payloadHash,
        risk: request.risk,
        revision: request.revision,
      },
      after: { payload, payloadHash, risk: check.risk, revision: request.revision + 1 },
    });
    await recordAudit(tx, {
      actor: { type: "SYSTEM" },
      action: "compliance.checked",
      entityType: "ApprovalRequest",
      entityId: request.id,
      correlationId,
      after: {
        outcome: check.outcome,
        risk: check.risk,
        violations: check.violations.length,
        revision: request.revision + 1,
      },
    });
    if (requiredRole !== request.requiredRole && requiredRole === "EXECUTIVE") {
      await notifyApprovers(tx, requiredRole, {
        title: `Executive decision needed: ${data.title}`,
        body: "An edit raised the risk level of this item.",
        href: `/approvals/${request.id}`,
        kind: NotificationKind.COMPLIANCE_FLAG,
      });
    }
    return { ...check, requiredRole };
  });
}

// ------------------------------------------------------------ outbound gate --

/**
 * The only way content may leave the building. Integrations call this before
 * posting, emailing, messaging or paying. It refuses unless the request is
 * APPROVED and the exact payload is the one that was approved.
 */
export async function assertDispatchable(client: DbClient, approvalId: string, payload: unknown) {
  const request = await client.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!request) throw new DispatchBlockedError("No approval exists for this item.");
  if (request.status !== ApprovalStatus.APPROVED || !request.decidedById) {
    throw new DispatchBlockedError(
      `Blocked: approval is ${request.status.toLowerCase()}, not approved.`,
    );
  }
  if (hashPayload(payload) !== request.payloadHash) {
    throw new DispatchBlockedError("Blocked: the content changed after it was approved.");
  }
  return request;
}
