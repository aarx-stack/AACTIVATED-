/**
 * The one path from a content draft into the Approval Queue, shared by the
 * company workflow, rep pods and human drafts in the Content Studio:
 * compliance check -> audit -> approval request -> statuses updated.
 */
import {
  ActivityKind,
  ApprovalType,
  type ContentChannel,
  ContentStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import type { DbClient } from "@/lib/db";
import type { ApprovalSource, SocialPostPayload } from "@/server/approvals/payload";
import { submitApproval } from "@/server/approvals/service";
import { recordAudit } from "@/server/audit/audit";
import { runComplianceCheck } from "@/server/compliance/service";

export interface ContentReviewInput {
  contentItemId: string;
  payload: SocialPostPayload & { channel: ContentChannel };
  summary: string;
  reasoning: string;
  sources: ApprovalSource[];
  /** The agent that drafted it (activity feed + audit actor). */
  agentId?: string | null;
  /** A human who wrote it: they cannot approve their own request. */
  requestedByUserId?: string | null;
  correlationId?: string | null;
  /** Tasks that move to IN_REVIEW. */
  taskIds?: string[];
  activityTaskId?: string | null;
}

export function payloadText(payload: Pick<SocialPostPayload, "title" | "caption" | "hashtags">) {
  return `${payload.title}\n${payload.caption}\n${payload.hashtags.join(" ")}`;
}

export async function checkAndSubmitContent(tx: DbClient, input: ContentReviewInput) {
  const { payload } = input;
  const check = await runComplianceCheck(tx, {
    text: payloadText(payload),
    channel: payload.channel,
    contentItemId: input.contentItemId,
  });

  if (input.agentId) {
    await tx.agentActivity.create({
      data: {
        agentId: input.agentId,
        kind: check.outcome === "PASS" ? ActivityKind.COMPLIANCE_CHECKED : ActivityKind.FLAGGED,
        message:
          check.outcome === "PASS"
            ? "Compliance check passed."
            : `Compliance check found ${check.violations.length} issue${check.violations.length === 1 ? "" : "s"} (${check.risk.toLowerCase()} risk). Sent for management review.`,
        taskId: input.activityTaskId ?? null,
      },
    });
  }
  await recordAudit(tx, {
    actor: { type: "SYSTEM" },
    action: "compliance.checked",
    entityType: "ContentItem",
    entityId: input.contentItemId,
    correlationId: input.correlationId,
    after: {
      outcome: check.outcome,
      risk: check.risk,
      violations: check.violations.map((v) => ({ match: v.match, severity: v.severity })),
    },
  });

  const approval = await submitApproval(tx, {
    type: ApprovalType.SOCIAL_POST,
    title: payload.title,
    summary: `${input.summary} Compliance: ${check.outcome.toLowerCase()}.`,
    payload: { ...payload },
    reasoning: input.reasoning,
    sources: input.sources,
    risk: check.risk,
    requestedByAgentId: input.agentId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
    contentItemId: input.contentItemId,
    correlationId: input.correlationId,
  });
  await tx.complianceCheck.update({
    where: { id: check.checkId },
    data: { approvalRequestId: approval.id },
  });
  await tx.contentItem.update({
    where: { id: input.contentItemId },
    data: { status: ContentStatus.IN_REVIEW, title: payload.title, body: payload.caption },
  });
  if (input.taskIds?.length) {
    await tx.task.updateMany({
      where: { id: { in: input.taskIds } },
      data: { status: TaskStatus.IN_REVIEW },
    });
  }
  if (input.agentId) {
    await tx.agentActivity.create({
      data: {
        agentId: input.agentId,
        kind: ActivityKind.SUBMITTED_FOR_APPROVAL,
        message: `Submitted "${payload.title}" to the Approval Queue.`,
        taskId: input.activityTaskId ?? null,
      },
    });
  }
  return { approval, check };
}
