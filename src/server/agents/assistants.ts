/**
 * Personal AI assistants: one for every executive, staff member and system admin.
 *
 * - Created automatically when someone is invited or moved into a company role, and paused
 *   (never deleted; history is kept) when they leave one.
 * - Only the owner gives it work and reads its drafts. Executives may look at staff assistants,
 *   never at another executive's. Its activity stays out of the shared Command Center feed.
 * - It writes internal drafts only. Anything meant for outside still goes through the Approval
 *   Queue, and its model spend goes through the budget gate like every agent.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ActivityKind,
  AgentKind,
  AgentStatus,
  Role,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { assistantProfile } from "./assistant-profile";
import { WORKING_STATUSES } from "./runner";

export { assistantProfile };

export const ASSISTANT_ROLES: readonly Role[] = [Role.EXECUTIVE, Role.STAFF, Role.SYSTEM_ADMIN];

/**
 * Makes sure a company user has an active assistant (creates one, or resumes a paused one).
 * Reps and suspended users get none; an existing one is paused instead.
 */
export async function syncPersonalAssistant(
  client: DbClient,
  user: { id: string; name: string | null; role: Role; status?: string; title?: string | null },
) {
  const existing = await client.agent.findFirst({
    where: { kind: AgentKind.PERSONAL, ownerId: user.id },
  });
  const eligible = ASSISTANT_ROLES.includes(user.role) && user.status !== "SUSPENDED";
  if (!eligible) {
    if (existing && existing.status !== AgentStatus.PAUSED) {
      await client.agent.update({
        where: { id: existing.id },
        data: { status: AgentStatus.PAUSED },
      });
    }
    return existing ? { ...existing, status: AgentStatus.PAUSED } : null;
  }
  const profile = assistantProfile(user);
  if (existing) {
    return client.agent.update({
      where: { id: existing.id },
      data: {
        status: existing.status === AgentStatus.PAUSED ? AgentStatus.ACTIVE : existing.status,
        title: profile.title,
      },
    });
  }
  return client.agent.create({
    data: {
      slug: `assistant-${user.id}`,
      name: profile.name,
      title: profile.title,
      kind: AgentKind.PERSONAL,
      status: AgentStatus.ACTIVE,
      ownerId: user.id,
      monthlyBudgetUsd: profile.monthlyBudgetUsd,
      currentFocus: "Ready for your first request.",
      config: profile.config,
    },
  });
}

export async function getMyAssistant(actor: Actor, client: DbClient = db) {
  return client.agent.findFirst({
    where: { kind: AgentKind.PERSONAL, ownerId: actor.id, status: { not: AgentStatus.PAUSED } },
    select: { id: true, name: true, title: true, status: true },
  });
}

export const assistantTaskSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().trim().min(3, "Give the request a short title.").max(120),
  instructions: z.string().trim().min(10, "Say what you need in a sentence or two.").max(4000),
});

/** The owner hands their assistant a request. The caller runs it (inline or on the queue). */
export async function assignToAssistant(
  actor: Actor,
  input: z.input<typeof assistantTaskSchema>,
  client: Db = db,
) {
  authorize(actor, "assistant.use");
  const data = assistantTaskSchema.parse(input);
  const agent = await client.agent.findUnique({ where: { id: data.agentId } });
  if (!agent || agent.kind !== AgentKind.PERSONAL || agent.ownerId !== actor.id) {
    throw new ForbiddenError("You can only give work to your own assistant.");
  }
  if (!WORKING_STATUSES.includes(agent.status)) {
    throw new ForbiddenError(
      `${agent.name} is ${agent.status.toLowerCase()} and cannot take work.`,
    );
  }
  const correlationId = randomUUID();
  return client.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title: data.title,
        description: data.instructions,
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        agentId: agent.id,
        createdById: actor.id,
        correlationId,
      },
    });
    await tx.agentActivity.create({
      data: {
        agentId: agent.id,
        kind: ActivityKind.DELEGATED,
        message: `New request: "${data.title}".`,
        taskId: task.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "assistant.task_assigned",
      entityType: "Task",
      entityId: task.id,
      correlationId,
      after: { agentId: agent.id },
    });
    return task;
  });
}
