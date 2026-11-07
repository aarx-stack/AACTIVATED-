/**
 * What reps do with their private AI team. Every function checks that the
 * actor is a rep with the right plan and only touches their own records.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ActivityKind,
  ApprovalStatus,
  ApprovalType,
  ConsentSource,
  ContactStatus,
  ContentChannel,
  ContentStatus,
  RepAgentRole,
  ReportPeriod,
  TaskStatus,
} from "@/generated/prisma/enums";
import type { ModelAdapter } from "@/lib/ai/types";
import { db, type Db } from "@/lib/db";
import { startOfMonth } from "@/lib/utils";
import { AgentUnavailableError, runSkill, SkillOutputError } from "@/server/agents/runner";
import {
  CHANNEL_LABEL,
  contentDraftSkill,
  coachPlanSkill,
  followUpSkill,
  WEEKDAYS,
} from "@/server/agents/skills";
import {
  assertDispatchable,
  DispatchBlockedError,
  submitApproval,
} from "@/server/approvals/service";
import { recordAudit } from "@/server/audit/audit";
import { authorize, type Actor, ForbiddenError } from "@/server/authz/permissions";
import { runComplianceCheck } from "@/server/compliance/service";
import { checkAndSubmitContent } from "@/server/content/review";
import { getGoHighLevel } from "@/server/integrations";
import { getPodAgent } from "./pods";

type RepActor = Actor & { name?: string | null };

export interface RepWorkflowResult {
  status: "submitted" | "blocked";
  correlationId: string;
  approvalId?: string;
  contentItemId?: string;
  compliance?: { outcome: string; risk: string; violations: number };
  error?: string;
}

function failureMessage(error: unknown) {
  if (error instanceof AgentUnavailableError || error instanceof SkillOutputError)
    return error.message;
  console.error("[reps] unexpected failure", error);
  return "Your AI team hit an internal error. Nothing was sent.";
}

async function blockTask(
  client: Db,
  taskId: string,
  agentId: string,
  correlationId: string,
  reason: string,
) {
  await client.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { status: TaskStatus.BLOCKED } });
    await tx.agentActivity.create({
      data: { agentId, kind: ActivityKind.ERROR, message: `Blocked: ${reason}`, taskId },
    });
    await recordAudit(tx, {
      actor: { type: "SYSTEM" },
      action: "workflow.blocked",
      entityType: "Task",
      entityId: taskId,
      correlationId,
      metadata: { reason },
    });
  });
}

// ------------------------------------------------------------ rep content --

export const repContentSchema = z.object({
  brief: z.string().trim().min(15, "Describe the post in a sentence or two.").max(1000),
  channel: z.enum([
    ContentChannel.FACEBOOK,
    ContentChannel.INSTAGRAM,
    ContentChannel.TIKTOK,
    ContentChannel.YOUTUBE,
  ]),
});

/** Premium rep asks their Content Creator for a post. It goes through compliance to management review. */
export async function requestRepContent(
  actor: RepActor,
  input: z.input<typeof repContentSchema>,
  options: { client?: Db; adapter?: ModelAdapter } = {},
): Promise<RepWorkflowResult> {
  authorize(actor, "rep_pod.full");
  authorize(actor, "content.create");
  const client = options.client ?? db;
  const data = repContentSchema.parse(input);
  const creator = await getPodAgent(client, actor.id, RepAgentRole.CONTENT_CREATOR);
  if (!creator)
    throw new AgentUnavailableError("Your Content Creator is not set up. Finish onboarding first.");
  const correlationId = randomUUID();

  const task = await client.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        title: `Draft ${CHANNEL_LABEL[data.channel]} post`,
        description: data.brief,
        status: TaskStatus.IN_PROGRESS,
        agentId: creator.id,
        createdById: actor.id,
        correlationId,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "workflow.requested",
      entityType: "Task",
      entityId: t.id,
      correlationId,
      after: { brief: data.brief, channel: data.channel, pod: true },
    });
    return t;
  });

  try {
    const brandDocs = await client.document.findMany({
      where: { category: { in: ["BRAND", "POLICIES"] }, accessLevel: "ALL_USERS" },
      select: { title: true },
      take: 3,
    });
    const draft = await runSkill(
      contentDraftSkill,
      creator,
      {
        brief: data.brief,
        channel: data.channel,
        assignment: {
          assignment: data.brief,
          checklist: ["Education only", "Branded stack names", "End with a question"],
          dueInHours: 24,
          assignee: "Content Creator",
        },
        brandSources: brandDocs.map((d) => d.title),
      },
      { purpose: "Rep pod: Content Creator drafts post", client, adapter: options.adapter },
    );

    const payload = {
      channel: data.channel,
      title: draft.output.title,
      caption: draft.output.caption,
      hashtags: draft.output.hashtags,
    };
    const { approval, check, item } = await client.$transaction(async (tx) => {
      const content = await tx.contentItem.create({
        data: {
          title: payload.title,
          body: payload.caption,
          channel: data.channel,
          status: ContentStatus.DRAFT,
          authorAgentId: creator.id,
          repId: actor.id,
          taskId: task.id,
        },
      });
      await tx.agentActivity.create({
        data: {
          agentId: creator.id,
          kind: ActivityKind.DRAFTED,
          message: `Drafted "${payload.title}".`,
          taskId: task.id,
        },
      });
      await recordAudit(tx, {
        actor: { type: "AGENT", agentId: creator.id },
        action: "content.drafted",
        entityType: "ContentItem",
        entityId: content.id,
        correlationId,
        after: { title: payload.title, caption: payload.caption, repId: actor.id },
        metadata: { model: draft.model, costUsd: draft.costUsd },
      });
      const review = await checkAndSubmitContent(tx, {
        contentItemId: content.id,
        payload,
        summary:
          `${CHANNEL_LABEL[data.channel]} post for rep ${actor.name ?? ""} (Content Creator).`.replace(
            " ()",
            "",
          ),
        reasoning: draft.output.reasoning,
        sources: draft.output.sources,
        agentId: creator.id,
        correlationId,
        taskIds: [task.id],
        activityTaskId: task.id,
      });
      return { ...review, item: content };
    });

    return {
      status: "submitted",
      correlationId,
      approvalId: approval.id,
      contentItemId: item.id,
      compliance: { outcome: check.outcome, risk: check.risk, violations: check.violations.length },
    };
  } catch (error) {
    const reason = failureMessage(error);
    await blockTask(client, task.id, creator.id, correlationId, reason);
    return { status: "blocked", correlationId, error: reason };
  }
}

// ------------------------------------------------------------- weekly plan --

/** Monday 00:00 of the week containing `now` (server local time). */
export function startOfWeek(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return d;
}

export const planWeekSchema = z.object({ goal: z.string().trim().max(300).optional() });

/** The Business Coach plans the rep's week as tasks for their pod. Internal only: nothing leaves the building. */
export async function planWeek(
  actor: RepActor,
  input: z.input<typeof planWeekSchema> = {},
  options: { client?: Db; adapter?: ModelAdapter; now?: Date } = {},
) {
  authorize(actor, "rep_pod.coach");
  const client = options.client ?? db;
  const { goal } = planWeekSchema.parse(input);
  const now = options.now ?? new Date();
  const coach = await getPodAgent(client, actor.id, RepAgentRole.BUSINESS_COACH);
  if (!coach)
    throw new AgentUnavailableError("Your Business Coach is not set up. Finish onboarding first.");

  const [profile, earnings, newContacts, pod] = await Promise.all([
    client.repProfile.findUnique({ where: { userId: actor.id } }),
    client.earning.aggregate({
      where: { repId: actor.id, period: startOfMonth(now) },
      _sum: { amountUsd: true },
    }),
    client.contact.count({ where: { repId: actor.id, status: ContactStatus.NEW } }),
    client.agent.findMany({
      where: { repPod: { repId: actor.id }, status: { not: "PAUSED" } },
      select: { id: true, repRole: true },
    }),
  ]);
  const premium = actor.role === "PREMIUM_REP";
  const plan = await runSkill(
    coachPlanSkill,
    coach,
    {
      repName: actor.name ?? "there",
      plan: premium ? "PREMIUM" : "FREE",
      presenterStatus: profile?.presenterStatus ?? "NONE",
      monthEarningsUsd: earnings._sum.amountUsd?.toNumber() ?? 0,
      newContacts,
      goal,
    },
    { purpose: "Rep pod: Business Coach weekly plan", client, adapter: options.adapter },
  );

  const weekStart = startOfWeek(now);
  const agentFor = (role: string) => pod.find((a) => a.repRole === role)?.id ?? coach.id;
  const weekLabel = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return client.$transaction(async (tx) => {
    // Re-planning replaces this week's open actions.
    const previous = await tx.task.findMany({
      where: {
        createdById: actor.id,
        parentId: null,
        title: { startsWith: "Weekly plan" },
        dueAt: { gte: weekStart },
      },
      select: { id: true },
    });
    if (previous.length) {
      const ids = previous.map((p) => p.id);
      await tx.task.updateMany({
        where: {
          OR: [
            { id: { in: ids } },
            { parentId: { in: ids }, status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] } },
          ],
        },
        data: { status: TaskStatus.CANCELLED },
      });
    }
    const parent = await tx.task.create({
      data: {
        title: `Weekly plan: week of ${weekLabel}`,
        description: plan.output.focus,
        status: TaskStatus.IN_PROGRESS,
        agentId: coach.id,
        createdById: actor.id,
        dueAt: new Date(weekStart.getTime() + 4 * 86_400_000 + 17 * 3_600_000),
      },
    });
    let count = 0;
    for (const day of plan.output.days) {
      const index = WEEKDAYS.indexOf(day.day);
      const due = new Date(weekStart.getTime() + index * 86_400_000 + 17 * 3_600_000);
      for (const action of day.actions) {
        await tx.task.create({
          data: {
            title: action.title,
            status: TaskStatus.TODO,
            agentId: premium ? agentFor(action.owner) : coach.id,
            createdById: actor.id,
            parentId: parent.id,
            dueAt: due,
          },
        });
        count++;
      }
    }
    await tx.report.create({
      data: {
        agentId: coach.id,
        period: ReportPeriod.WEEKLY,
        title: `Week of ${weekLabel}`,
        body: `${plan.output.focus}\n\n${plan.output.encouragement}`,
      },
    });
    await tx.agentActivity.create({
      data: {
        agentId: coach.id,
        kind: ActivityKind.PLANNED,
        message: `Planned the week: ${count} actions.`,
        taskId: parent.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "AGENT", agentId: coach.id },
      action: "rep.week_planned",
      entityType: "Task",
      entityId: parent.id,
      after: { focus: plan.output.focus, actions: count },
      metadata: { requestedBy: actor.id, model: plan.model, costUsd: plan.costUsd },
    });
    return {
      taskId: parent.id,
      actions: count,
      focus: plan.output.focus,
      encouragement: plan.output.encouragement,
    };
  });
}

/** A rep ticks off one of their pod's actions. */
export async function completeRepTask(
  actor: Actor,
  taskId: string,
  done: boolean,
  client: Db = db,
) {
  authorize(actor, "rep_pod.coach");
  const task = await client.task.findFirst({
    where: { id: taskId, agent: { repPod: { repId: actor.id } } },
    select: { id: true, status: true },
  });
  if (!task) throw new ForbiddenError("That task is not part of your AI team.");
  return client.task.update({
    where: { id: taskId },
    data: done
      ? { status: TaskStatus.DONE, completedAt: new Date() }
      : { status: TaskStatus.TODO, completedAt: null },
  });
}

// --------------------------------------------------------------- contacts --

/** Consent is mandatory: where, when and what the person did to opt in. No imports, no scraping. */
export const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    phone: z
      .string()
      .trim()
      .max(40)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    preferredChannel: z.enum(ContentChannel),
    consentSource: z.enum(ConsentSource),
    consentAt: z.coerce.date(),
    consentEvidence: z.string().trim().min(5, "Describe how they opted in.").max(300),
  })
  .refine((c) => c.consentAt.getTime() <= Date.now() + 60_000, {
    message: "Consent cannot be in the future.",
    path: ["consentAt"],
  })
  .refine((c) => c.email || c.phone, {
    message: "Add an email or a phone number.",
    path: ["email"],
  });

export async function addContact(
  actor: Actor,
  input: z.input<typeof contactSchema>,
  client: Db = db,
) {
  authorize(actor, "leads.manage_own");
  const data = contactSchema.parse(input);
  return client.$transaction(async (tx) => {
    const contact = await tx.contact.create({ data: { ...data, repId: actor.id } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "contact.added",
      entityType: "Contact",
      entityId: contact.id,
      after: {
        consentSource: data.consentSource,
        consentAt: data.consentAt,
        consentEvidence: data.consentEvidence,
      },
    });
    return contact;
  });
}

export async function setContactStatus(
  actor: Actor,
  contactId: string,
  status: ContactStatus,
  client: Db = db,
) {
  authorize(actor, "leads.manage_own");
  return client.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({ where: { id: contactId, repId: actor.id } });
    if (!contact) throw new ForbiddenError("That contact is not yours.");
    const updated = await tx.contact.update({ where: { id: contactId }, data: { status } });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: status === ContactStatus.OPTED_OUT ? "contact.opted_out" : "contact.status_changed",
      entityType: "Contact",
      entityId: contactId,
      before: { status: contact.status },
      after: { status },
    });
    return updated;
  });
}

// ----------------------------------------------------------- follow-ups --

const MESSAGE_CHANNEL_TYPE = (channel: ContentChannel) =>
  channel === ContentChannel.EMAIL ? ApprovalType.EMAIL : ApprovalType.DIRECT_MESSAGE;

export interface FollowUpPayload {
  contactId: string;
  to: string;
  channel: ContentChannel;
  subject?: string;
  message: string;
}

/** The Lead Follow-up Specialist drafts one message to a consented contact; it waits for approval. */
export async function draftFollowUp(
  actor: RepActor,
  contactId: string,
  note: string | undefined,
  options: { client?: Db; adapter?: ModelAdapter } = {},
): Promise<RepWorkflowResult> {
  authorize(actor, "leads.manage_own");
  const client = options.client ?? db;
  const contact = await client.contact.findFirst({ where: { id: contactId, repId: actor.id } });
  if (!contact) throw new ForbiddenError("That contact is not yours.");
  if (contact.status === ContactStatus.OPTED_OUT)
    throw new ForbiddenError("This contact opted out. No messages.");
  const pending = await client.approvalRequest.count({
    where: { contactId, status: ApprovalStatus.PENDING },
  });
  if (pending)
    throw new ForbiddenError("A follow-up for this contact is already waiting for approval.");
  const agent = await getPodAgent(client, actor.id, RepAgentRole.LEAD_FOLLOWUP);
  if (!agent) throw new AgentUnavailableError("Your Lead Follow-up Specialist is not set up.");

  const correlationId = randomUUID();
  const task = await client.task.create({
    data: {
      title: `Follow up with ${contact.name}`,
      status: TaskStatus.IN_PROGRESS,
      agentId: agent.id,
      createdById: actor.id,
      correlationId,
    },
  });
  try {
    const draft = await runSkill(
      followUpSkill,
      agent,
      {
        repName: actor.name ?? "your rep",
        contact: {
          name: contact.name,
          consentEvidence: contact.consentEvidence,
          channel: contact.preferredChannel,
          status: contact.status,
        },
        note: note?.trim() || undefined,
      },
      { purpose: "Rep pod: Lead Follow-up drafts message", client, adapter: options.adapter },
    );
    const payload: FollowUpPayload = {
      contactId,
      to: contact.name,
      channel: contact.preferredChannel,
      ...(draft.output.subject ? { subject: draft.output.subject } : {}),
      message: draft.output.message,
    };
    const result = await client.$transaction(async (tx) => {
      const check = await runComplianceCheck(tx, {
        text: `${payload.subject ?? ""}\n${payload.message}`,
        channel: contact.preferredChannel,
      });
      await recordAudit(tx, {
        actor: { type: "AGENT", agentId: agent.id },
        action: "lead.followup_drafted",
        entityType: "Contact",
        entityId: contactId,
        correlationId,
        after: { message: payload.message },
      });
      await recordAudit(tx, {
        actor: { type: "SYSTEM" },
        action: "compliance.checked",
        entityType: "Contact",
        entityId: contactId,
        correlationId,
        after: { outcome: check.outcome, risk: check.risk },
      });
      const approval = await submitApproval(tx, {
        type: MESSAGE_CHANNEL_TYPE(contact.preferredChannel),
        title: `Follow-up to ${contact.name}`,
        summary: `${CHANNEL_LABEL[contact.preferredChannel]} message to a consented contact. Compliance: ${check.outcome.toLowerCase()}.`,
        payload: payload as unknown as Record<string, unknown>,
        reasoning: draft.output.reasoning,
        sources: draft.output.sources,
        risk: check.risk,
        requestedByAgentId: agent.id,
        correlationId,
      });
      await tx.approvalRequest.update({ where: { id: approval.id }, data: { contactId } });
      await tx.complianceCheck.update({
        where: { id: check.checkId },
        data: { approvalRequestId: approval.id },
      });
      await tx.task.update({ where: { id: task.id }, data: { status: TaskStatus.IN_REVIEW } });
      await tx.agentActivity.create({
        data: {
          agentId: agent.id,
          kind: ActivityKind.SUBMITTED_FOR_APPROVAL,
          message: `Drafted a follow-up to ${contact.name} for approval.`,
          taskId: task.id,
        },
      });
      return { approval, check };
    });
    return {
      status: "submitted",
      correlationId,
      approvalId: result.approval.id,
      compliance: {
        outcome: result.check.outcome,
        risk: result.check.risk,
        violations: result.check.violations.length,
      },
    };
  } catch (error) {
    const reason = failureMessage(error);
    await blockTask(client, task.id, agent.id, correlationId, reason);
    return { status: "blocked", correlationId, error: reason };
  }
}

/**
 * Sends an approved follow-up. Gate: approved + unchanged payload, not sent
 * before, and the contact has not opted out since.
 */
export async function sendFollowUp(actor: Actor, approvalId: string, client: Db = db) {
  authorize(actor, "leads.manage_own");
  const approval = await client.approvalRequest.findUnique({
    where: { id: approvalId },
    include: { contact: true },
  });
  if (!approval?.contact || approval.contact.repId !== actor.id)
    throw new ForbiddenError("That follow-up is not yours.");
  if (approval.dispatchedAt) throw new DispatchBlockedError("Already sent.");
  if (approval.contact.status === ContactStatus.OPTED_OUT) {
    throw new DispatchBlockedError(
      "Blocked: this contact opted out after the message was approved.",
    );
  }
  await assertDispatchable(client, approvalId, approval.payload);
  const payload = approval.payload as unknown as FollowUpPayload;
  const profile = await client.repProfile.findUnique({ where: { userId: actor.id } });
  if (!profile?.ghlSubAccountId)
    throw new DispatchBlockedError("Your GoHighLevel sub-account is not set up.");

  const sent = await getGoHighLevel().sendMessage({
    subAccountId: profile.ghlSubAccountId,
    contactId: approval.contact.ghlContactId ?? approval.contact.id,
    channel: payload.channel,
    subject: payload.subject,
    message: payload.message,
  });

  return client.$transaction(async (tx) => {
    const claimed = await tx.approvalRequest.updateMany({
      where: { id: approvalId, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    });
    if (claimed.count !== 1) throw new DispatchBlockedError("Already sent.");
    await tx.contact.update({
      where: { id: approval.contact!.id },
      data: { status: ContactStatus.FOLLOWING_UP, lastContactedAt: new Date() },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "lead.followup_sent",
      entityType: "ApprovalRequest",
      entityId: approvalId,
      correlationId: approval.correlationId,
      after: {
        externalId: sent.externalId,
        channel: payload.channel,
        payloadHash: approval.payloadHash,
      },
    });
    return { externalId: sent.externalId };
  });
}
