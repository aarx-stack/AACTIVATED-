/**
 * Phase 2 milestone workflow: one content request end to end.
 *
 *   human request
 *     -> Brain plans                 (brain.plan)
 *     -> Operations Manager delegates (operations.delegate, handoff)
 *     -> Content Specialist drafts    (content.draft)
 *     -> automated compliance check
 *     -> Approval Queue               (human decides there; see approvals/service.ts)
 *     -> approved and ready to schedule
 *
 * Every step writes an AuditLog entry with the same correlationId. Model calls
 * run outside transactions; each step's records commit together with its audit
 * entry. If an agent is unavailable or returns bad output, the workflow stops,
 * the task is marked BLOCKED and the failure is audited. Nothing is sent anywhere.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ActivityKind,
  AgentKind,
  ApprovalType,
  ContentChannel,
  ContentStatus,
  HandoffStatus,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/enums";
import type { ModelAdapter } from "@/lib/ai/types";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/authz/permissions";
import { submitApproval } from "@/server/approvals/service";
import { runComplianceCheck } from "@/server/compliance/service";
import { AgentUnavailableError, runSkill, SkillOutputError, type RunnableAgent } from "./runner";
import { brainPlanSkill, CHANNEL_LABEL, contentDraftSkill, opsDelegateSkill } from "./skills";

export const WORKFLOW_AGENTS = {
  brain: "brain",
  operations: "ops-manager",
  content: "content-specialist",
} as const;

export const SOCIAL_CHANNELS = [
  ContentChannel.FACEBOOK,
  ContentChannel.INSTAGRAM,
  ContentChannel.TIKTOK,
  ContentChannel.YOUTUBE,
] as const;

export const contentRequestSchema = z.object({
  brief: z.string().trim().min(15, "Describe the content in a sentence or two.").max(1000),
  channel: z.enum(SOCIAL_CHANNELS),
});

export type ContentRequestInput = z.input<typeof contentRequestSchema>;

export interface WorkflowResult {
  status: "submitted" | "blocked";
  correlationId: string;
  taskId: string;
  approvalId?: string;
  contentItemId?: string;
  compliance?: { outcome: string; risk: string; violations: number };
  error?: string;
}

/** Step 0: a human asks the Brain for content. Creates the request task. */
export async function startContentRequest(
  actor: Actor & { name?: string | null },
  input: ContentRequestInput,
  client: Db = db,
) {
  authorize(actor, "workflow.request");
  const data = contentRequestSchema.parse(input);
  const brain = await client.agent.findFirst({ where: { kind: AgentKind.BRAIN } });
  if (!brain) throw new AgentUnavailableError("The Brain is not configured.");
  const correlationId = randomUUID();

  return client.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title: `Content request: ${data.brief.slice(0, 80)}`,
        description: data.brief,
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        agentId: brain.id,
        createdById: actor.id,
        correlationId,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "workflow.requested",
      entityType: "Task",
      entityId: task.id,
      correlationId,
      after: { brief: data.brief, channel: data.channel },
    });
    return { taskId: task.id, correlationId, channel: data.channel };
  });
}

async function loadAgent(client: Db, slug: string): Promise<RunnableAgent> {
  const agent = await client.agent.findUnique({
    where: { slug },
    select: { id: true, name: true, title: true, status: true, config: true, departmentId: true },
  });
  if (!agent) throw new AgentUnavailableError(`Agent "${slug}" is not configured.`);
  return agent;
}

/** Steps 1-5. Safe to run inline (server action) or in the background worker. */
export async function runContentWorkflow(
  taskId: string,
  channel: ContentChannel,
  options: { client?: Db; adapter?: ModelAdapter } = {},
): Promise<WorkflowResult> {
  const client = options.client ?? db;
  const request = await client.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { createdBy: { select: { name: true, email: true } } },
  });
  const correlationId = request.correlationId ?? randomUUID();
  const brief = request.description ?? request.title;
  const runOpts = { client, adapter: options.adapter };
  let currentAgentId: string | null = request.agentId;

  try {
    const [brain, ops, writer] = await Promise.all([
      loadAgent(client, WORKFLOW_AGENTS.brain),
      loadAgent(client, WORKFLOW_AGENTS.operations),
      loadAgent(client, WORKFLOW_AGENTS.content),
    ]);

    // 1. Brain plans and delegates to Operations.
    currentAgentId = brain.id;
    const plan = await runSkill(
      brainPlanSkill,
      brain,
      { brief, channel, requestedBy: request.createdBy?.name ?? "A team member" },
      { purpose: "Workflow: Brain plans content request", ...runOpts },
    );
    const opsTask = await client.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.IN_PROGRESS, priority: plan.output.priority },
      });
      const sub = await tx.task.create({
        data: {
          title: `Coordinate: ${plan.output.objective.slice(0, 90)}`,
          description: plan.output.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
          status: TaskStatus.IN_PROGRESS,
          priority: plan.output.priority,
          agentId: ops.id,
          departmentId: ops.departmentId,
          parentId: taskId,
          createdById: request.createdById,
          correlationId,
        },
      });
      await tx.handoff.create({
        data: {
          fromAgentId: brain.id,
          toAgentId: ops.id,
          taskId: sub.id,
          status: HandoffStatus.ACCEPTED,
          note: plan.output.objective,
        },
      });
      await tx.agentActivity.create({
        data: {
          agentId: brain.id,
          kind: ActivityKind.PLANNED,
          message: `Planned: ${plan.output.objective}`,
          taskId,
        },
      });
      await tx.agentActivity.create({
        data: {
          agentId: brain.id,
          kind: ActivityKind.DELEGATED,
          message: "Delegated the content request to the Operations Manager.",
          taskId: sub.id,
        },
      });
      await recordAudit(tx, {
        actor: { type: "AGENT", agentId: brain.id },
        action: "brain.planned",
        entityType: "Task",
        entityId: taskId,
        correlationId,
        after: plan.output,
        metadata: { model: plan.model, costUsd: plan.costUsd },
      });
      await recordAudit(tx, {
        actor: { type: "AGENT", agentId: brain.id },
        action: "task.delegated",
        entityType: "Task",
        entityId: sub.id,
        correlationId,
        metadata: { from: brain.title, to: ops.title },
      });
      return sub;
    });

    // 2. Operations turns the plan into an assignment for the Content Specialist.
    currentAgentId = ops.id;
    const assignment = await runSkill(
      opsDelegateSkill,
      ops,
      { brief, channel, plan: plan.output },
      { purpose: "Workflow: Operations assigns content", ...runOpts },
    );
    const writerTask = await client.$transaction(async (tx) => {
      const sub = await tx.task.create({
        data: {
          title: `Draft ${CHANNEL_LABEL[channel]} post`,
          description: `${assignment.output.assignment}\n\nChecklist:\n${assignment.output.checklist.map((c) => `- ${c}`).join("\n")}`,
          status: TaskStatus.IN_PROGRESS,
          priority: plan.output.priority,
          agentId: writer.id,
          departmentId: writer.departmentId,
          parentId: taskId,
          createdById: request.createdById,
          dueAt: new Date(Date.now() + assignment.output.dueInHours * 3600_000),
          correlationId,
        },
      });
      await tx.task.update({
        where: { id: opsTask.id },
        data: { status: TaskStatus.DONE, completedAt: new Date() },
      });
      await tx.handoff.create({
        data: {
          fromAgentId: ops.id,
          toAgentId: writer.id,
          taskId: sub.id,
          status: HandoffStatus.ACCEPTED,
          note: assignment.output.assignment,
        },
      });
      await tx.agentActivity.create({
        data: {
          agentId: ops.id,
          kind: ActivityKind.HANDOFF,
          message: "Assigned the draft to the Content Specialist.",
          taskId: sub.id,
        },
      });
      await recordAudit(tx, {
        actor: { type: "AGENT", agentId: ops.id },
        action: "task.assigned",
        entityType: "Task",
        entityId: sub.id,
        correlationId,
        after: assignment.output,
        metadata: { model: assignment.model, costUsd: assignment.costUsd },
      });
      return sub;
    });

    // 3. Content Specialist drafts.
    currentAgentId = writer.id;
    const brandDocs = await client.document.findMany({
      where: { category: { in: ["BRAND", "POLICIES"] }, accessLevel: "ALL_USERS" },
      select: { title: true },
      take: 4,
    });
    const draft = await runSkill(
      contentDraftSkill,
      writer,
      {
        brief,
        channel,
        assignment: assignment.output,
        brandSources: brandDocs.map((d) => d.title),
      },
      { purpose: "Workflow: Content Specialist drafts post", ...runOpts },
    );
    const content = await client.$transaction(async (tx) => {
      const item = await tx.contentItem.create({
        data: {
          title: draft.output.title,
          body: draft.output.caption,
          channel,
          status: ContentStatus.DRAFT,
          authorAgentId: writer.id,
          taskId: writerTask.id,
        },
      });
      await tx.agentActivity.create({
        data: {
          agentId: writer.id,
          kind: ActivityKind.DRAFTED,
          message: `Drafted "${draft.output.title}".`,
          taskId: writerTask.id,
        },
      });
      await recordAudit(tx, {
        actor: { type: "AGENT", agentId: writer.id },
        action: "content.drafted",
        entityType: "ContentItem",
        entityId: item.id,
        correlationId,
        after: { title: item.title, caption: item.body, hashtags: draft.output.hashtags },
        metadata: { model: draft.model, costUsd: draft.costUsd },
      });
      return item;
    });

    // 4 + 5. Compliance check, then into the Approval Queue — always, so a human decides.
    const payload = {
      channel,
      title: draft.output.title,
      caption: draft.output.caption,
      hashtags: draft.output.hashtags,
    };
    const result = await client.$transaction(async (tx) => {
      const check = await runComplianceCheck(tx, {
        text: `${payload.title}\n${payload.caption}\n${payload.hashtags.join(" ")}`,
        channel,
        contentItemId: content.id,
      });
      await tx.agentActivity.create({
        data: {
          agentId: writer.id,
          kind: check.outcome === "PASS" ? ActivityKind.COMPLIANCE_CHECKED : ActivityKind.FLAGGED,
          message:
            check.outcome === "PASS"
              ? "Compliance check passed."
              : `Compliance check found ${check.violations.length} issue${check.violations.length === 1 ? "" : "s"} (${check.risk.toLowerCase()} risk). Sent for management review.`,
          taskId: writerTask.id,
        },
      });
      await recordAudit(tx, {
        actor: { type: "SYSTEM" },
        action: "compliance.checked",
        entityType: "ContentItem",
        entityId: content.id,
        correlationId,
        after: {
          outcome: check.outcome,
          risk: check.risk,
          violations: check.violations.map((v) => ({ match: v.match, severity: v.severity })),
        },
      });

      const approval = await submitApproval(tx, {
        type: ApprovalType.SOCIAL_POST,
        title: draft.output.title,
        summary: `${CHANNEL_LABEL[channel]} post drafted by the Content Specialist. Compliance: ${check.outcome.toLowerCase()}.`,
        payload,
        reasoning: draft.output.reasoning,
        sources: draft.output.sources,
        risk: check.risk,
        requestedByAgentId: writer.id,
        contentItemId: content.id,
        correlationId,
      });
      await tx.complianceCheck.update({
        where: { id: check.checkId },
        data: { approvalRequestId: approval.id },
      });
      await tx.contentItem.update({
        where: { id: content.id },
        data: { status: ContentStatus.IN_REVIEW },
      });
      await tx.task.update({
        where: { id: writerTask.id },
        data: { status: TaskStatus.IN_REVIEW },
      });
      await tx.task.update({ where: { id: taskId }, data: { status: TaskStatus.IN_REVIEW } });
      await tx.agentActivity.create({
        data: {
          agentId: writer.id,
          kind: ActivityKind.SUBMITTED_FOR_APPROVAL,
          message: `Submitted "${draft.output.title}" to the Approval Queue.`,
          taskId: writerTask.id,
        },
      });
      return { approvalId: approval.id, check };
    });

    return {
      status: "submitted",
      correlationId,
      taskId,
      approvalId: result.approvalId,
      contentItemId: content.id,
      compliance: {
        outcome: result.check.outcome,
        risk: result.check.risk,
        violations: result.check.violations.length,
      },
    };
  } catch (error) {
    if (!(error instanceof AgentUnavailableError || error instanceof SkillOutputError)) {
      console.error("[workflow] unexpected failure", error);
    }
    const message =
      error instanceof AgentUnavailableError || error instanceof SkillOutputError
        ? error.message
        : "The workflow stopped because of an internal error. Nothing was sent.";
    await client.$transaction(async (tx) => {
      await tx.task.updateMany({
        where: { OR: [{ id: taskId }, { parentId: taskId, status: { not: TaskStatus.DONE } }] },
        data: { status: TaskStatus.BLOCKED },
      });
      if (currentAgentId) {
        await tx.agentActivity.create({
          data: {
            agentId: currentAgentId,
            kind: ActivityKind.ERROR,
            message: `Workflow blocked: ${message}`,
            taskId,
          },
        });
      }
      await recordAudit(tx, {
        actor: { type: "SYSTEM" },
        action: "workflow.blocked",
        entityType: "Task",
        entityId: taskId,
        correlationId,
        metadata: { reason: message },
      });
    });
    return { status: "blocked", correlationId, taskId, error: message };
  }
}
