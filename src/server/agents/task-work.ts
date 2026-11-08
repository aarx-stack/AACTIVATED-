/**
 * Agents working prompt tasks (sent from the Prompt Generator).
 *
 * The agent produces an internal draft and the task moves to In Review for a person. Nothing
 * leaves the company here: anything meant for outside still goes through the Approval Queue.
 * Model spend goes through the budget gate like every other call.
 */
import { ActivityKind, TaskStatus } from "@/generated/prisma/enums";
import type { ModelAdapter } from "@/lib/ai/types";
import { db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { type Actor, authorize, ForbiddenError } from "@/server/authz/permissions";
import { canOpenAgentWorkspace } from "@/server/authz/policies";
import { AgentUnavailableError, runSkill, SkillOutputError } from "./runner";
import { type TaskWorkOutput, taskWorkOutput, taskWorkSkill } from "./skills";

type Db = typeof db;

export type TaskWorkResult =
  | { status: "done"; taskId: string; output: TaskWorkOutput }
  | { status: "blocked"; taskId: string; message: string }
  | { status: "skipped"; taskId: string; message: string };

/** Statuses an agent may (re)start from. Retrying a blocked task is allowed. */
const STARTABLE: TaskStatus[] = [TaskStatus.TODO, TaskStatus.BLOCKED];

export function readTaskOutput(json: unknown): TaskWorkOutput | null {
  const parsed = taskWorkOutput.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function runPromptTask(
  taskId: string,
  options: { client?: Db; adapter?: ModelAdapter } = {},
): Promise<TaskWorkResult> {
  const client = options.client ?? db;
  const task = await client.task.findUnique({ where: { id: taskId }, include: { agent: true } });
  if (!task?.agent) return { status: "skipped", taskId, message: "That task has no agent." };

  // Claim the task. A second run (a queue retry, a double click) finds it already taken.
  const claimed = await client.task.updateMany({
    where: { id: taskId, status: { in: STARTABLE } },
    data: { status: TaskStatus.IN_PROGRESS, lastError: null },
  });
  if (claimed.count === 0) {
    return { status: "skipped", taskId, message: "The agent is already working on this task." };
  }
  const agent = task.agent;
  await client.agentActivity.create({
    data: {
      agentId: agent.id,
      kind: ActivityKind.STARTED,
      message: `Started "${task.title}".`,
      taskId,
    },
  });

  try {
    const result = await runSkill(
      taskWorkSkill,
      agent,
      { title: task.title, prompt: task.description ?? task.title, agentTitle: agent.title },
      { purpose: "prompt task", client, adapter: options.adapter },
    );
    await client.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.IN_REVIEW,
          output: result.output,
          outputAt: new Date(),
          lastError: null,
        },
      });
      await tx.agentActivity.create({
        data: {
          agentId: agent.id,
          kind: ActivityKind.COMPLETED,
          message: `Finished a draft for "${task.title}". Ready for review.`,
          taskId,
        },
      });
      await recordAudit(tx, {
        actor: { type: "AGENT", agentId: agent.id },
        action: "task.worked",
        entityType: "Task",
        entityId: taskId,
        correlationId: task.correlationId,
        metadata: { model: result.model, provider: result.provider, costUsd: result.costUsd },
      });
    });
    return { status: "done", taskId, output: result.output };
  } catch (error) {
    const known = error instanceof AgentUnavailableError || error instanceof SkillOutputError;
    if (!known) console.error("[task-work] unexpected failure", error);
    const message = known
      ? error.message
      : "The agent stopped because of an internal error. Nothing was sent.";
    await client.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.BLOCKED, lastError: message },
      });
      await tx.agentActivity.create({
        data: {
          agentId: agent.id,
          kind: ActivityKind.ERROR,
          message: `Blocked: ${message}`,
          taskId,
        },
      });
      await recordAudit(tx, {
        actor: { type: "SYSTEM" },
        action: "task.blocked",
        entityType: "Task",
        entityId: taskId,
        correlationId: task.correlationId,
        metadata: { reason: message },
      });
    });
    return { status: "blocked", taskId, message };
  }
}

// ------------------------------------------------------------ people's side --

async function loadForPerson(actor: Actor, taskId: string, client: Db) {
  const task = await client.task.findUnique({
    where: { id: taskId },
    include: { agent: { include: { department: { select: { isConfidential: true } } } } },
  });
  if (!task?.agent) throw new ForbiddenError("That task is not available to you.");
  // A personal assistant's work is its owner's alone.
  if (task.agent.kind === "PERSONAL") {
    authorize(actor, "assistant.use");
    if (task.agent.ownerId !== actor.id) {
      throw new ForbiddenError("That task is not available to you.");
    }
    return task;
  }
  authorize(actor, "prompts.use");
  if (!canOpenAgentWorkspace(actor.role, task.agent, actor.id)) {
    throw new ForbiddenError("That task is not available to you.");
  }
  return task;
}

/** A person accepts the agent's draft. */
export async function markTaskDone(actor: Actor, taskId: string, client: Db = db) {
  const task = await loadForPerson(actor, taskId, client);
  if (task.status !== TaskStatus.IN_REVIEW || task.output === null) {
    throw new TaskStateError("Only a finished draft that is in review can be marked done.");
  }
  await client.$transaction(async (tx) => {
    const updated = await tx.task.updateMany({
      where: { id: taskId, status: TaskStatus.IN_REVIEW },
      data: { status: TaskStatus.DONE, completedAt: new Date() },
    });
    if (updated.count === 0) throw new TaskStateError("This task changed. Reload and try again.");
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "task.completed",
      entityType: "Task",
      entityId: taskId,
      correlationId: task.correlationId,
    });
  });
  return task.agent!.id;
}

/** Checks a blocked prompt task may be retried; the caller then runs or queues it. */
export async function assertRetryable(actor: Actor, taskId: string, client: Db = db) {
  const task = await loadForPerson(actor, taskId, client);
  if (task.status !== TaskStatus.BLOCKED || task.lastError === null) {
    throw new TaskStateError("Only a blocked prompt task can be tried again.");
  }
  return task.agent!.id;
}

export class TaskStateError extends Error {
  readonly status = 409;
}
