"use server";

import { revalidatePath } from "next/cache";
import { getEnv } from "@/lib/env";
import { actionError, type ActionState } from "@/server/action-result";
import { assignToAssistant } from "@/server/agents/assistants";
import { setAgentPaused } from "@/server/agents/manage";
import {
  assertRetryable,
  markTaskDone,
  runPromptTask,
  TaskStateError,
} from "@/server/agents/task-work";
import { enqueue } from "@/server/jobs/client";
import { QUEUES } from "@/server/jobs/queues";
import { requireActionPermission, requireUser } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz/permissions";

export async function setAgentPausedAction(agentId: string, paused: boolean) {
  try {
    const actor = await requireActionPermission("agent.manage");
    await setAgentPaused(actor, agentId, paused);
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");
    revalidatePath("/team");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof ForbiddenError ? error.message : "Could not update the agent.",
    };
  }
}

function taskError(error: unknown) {
  return {
    ok: false as const,
    error:
      error instanceof ForbiddenError || error instanceof TaskStateError
        ? error.message
        : "Could not update the task.",
  };
}

export async function markTaskDoneAction(taskId: string) {
  try {
    const actor = await requireUser();
    const agentId = await markTaskDone(actor, String(taskId));
    revalidatePath(`/agents/${agentId}`);
    return { ok: true as const, message: "Marked done." };
  } catch (error) {
    return taskError(error);
  }
}

export async function retryTaskAction(taskId: string) {
  try {
    const actor = await requireUser();
    const agentId = await assertRetryable(actor, String(taskId));
    if (getEnv().AGENT_EXECUTION === "queue") {
      await enqueue(QUEUES.promptTask, { taskId });
      revalidatePath(`/agents/${agentId}`);
      return { ok: true as const, message: "Queued. The agent will start shortly." };
    }
    const result = await runPromptTask(String(taskId));
    revalidatePath(`/agents/${agentId}`);
    if (result.status === "blocked") return { ok: false as const, error: result.message };
    if (result.status === "skipped") return { ok: false as const, error: result.message };
    return { ok: true as const, message: "Draft ready for review." };
  } catch (error) {
    return taskError(error);
  }
}

export async function askAssistantAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("assistant.use");
    const agentId = String(form.get("agentId") ?? "");
    const task = await assignToAssistant(actor, {
      agentId,
      title: String(form.get("title") ?? ""),
      instructions: String(form.get("instructions") ?? ""),
    });
    if (getEnv().AGENT_EXECUTION === "queue") {
      await enqueue(QUEUES.promptTask, { taskId: task.id });
      revalidatePath(`/agents/${agentId}`);
      return { status: "done", message: "Sent. Your assistant will start shortly." };
    }
    const result = await runPromptTask(task.id);
    revalidatePath(`/agents/${agentId}`);
    if (result.status === "blocked") {
      return { status: "error", message: `Your assistant could not finish: ${result.message}` };
    }
    return { status: "done", message: "Done. The draft is under In Review." };
  } catch (error) {
    return actionError(error);
  }
}
