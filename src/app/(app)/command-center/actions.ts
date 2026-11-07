"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AgentKind } from "@/generated/prisma/enums";
import { runModel } from "@/lib/ai";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  contentRequestSchema,
  runContentWorkflow,
  startContentRequest,
} from "@/server/agents/content-workflow";
import { recordAudit } from "@/server/audit/audit";
import { requireActionPermission } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz/permissions";
import { enqueue } from "@/server/jobs/client";
import { QUEUES } from "@/server/jobs/queues";
import { buildBrainSnapshot, getCommandCenterData } from "@/server/queries/command-center";

export type AskBrainState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "answered"; question: string; answer: string; provider: string; costUsd: number };

const BRAIN_SYSTEM = `You are the Brain, the AI CEO of AACTIVATED RX (peptide education and wellness).
You coordinate a team of AI agents. Humans approve anything that leaves the company.
Answer briefly and concretely using only the snapshot below. Never make medical or health claims.
If an action would send anything outside the company, say it must go through the Approval Queue.`;

const questionSchema = z.string().trim().min(3, "Ask a slightly longer question.").max(1000);

export async function askBrain(_prev: AskBrainState, formData: FormData): Promise<AskBrainState> {
  let user;
  try {
    user = await requireActionPermission("brain.ask");
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: "error", message: error.message };
    return { status: "error", message: "Please sign in again." };
  }

  const parsed = questionSchema.safeParse(formData.get("question"));
  if (!parsed.success)
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid question." };

  try {
    const [data, brain] = await Promise.all([
      getCommandCenterData(user.role),
      db.agent.findFirst({ where: { kind: AgentKind.BRAIN }, select: { id: true } }),
    ]);
    const result = await runModel({
      tier: "brain",
      purpose: "Ask the Brain (Command Center)",
      agentId: brain?.id,
      system: `${BRAIN_SYSTEM}\n\n${buildBrainSnapshot(data)}`,
      messages: [{ role: "user", content: parsed.data }],
      maxTokens: 2000,
    });

    await recordAudit(db, {
      actor: { type: "USER", userId: user.id },
      action: "brain.asked",
      entityType: "Agent",
      entityId: brain?.id,
      metadata: {
        question: parsed.data,
        provider: result.provider,
        model: result.model,
        costUsd: result.costUsd,
      },
    });

    if (result.refused) {
      return { status: "error", message: "The Brain declined that request. Try rephrasing it." };
    }
    return {
      status: "answered",
      question: parsed.data,
      answer: result.text,
      provider: result.provider,
      costUsd: result.costUsd,
    };
  } catch (error) {
    console.error("[askBrain]", error);
    return {
      status: "error",
      message: "The Brain is unavailable right now. Your dashboard data is unaffected.",
    };
  }
}

// ------------------------------------------------------ content request flow --

export type ContentRequestState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "queued"; taskId: string }
  | {
      status: "submitted" | "blocked";
      taskId: string;
      correlationId: string;
      approvalId?: string;
      compliance?: { outcome: string; risk: string; violations: number };
      error?: string;
    };

export async function requestContent(
  _prev: ContentRequestState,
  formData: FormData,
): Promise<ContentRequestState> {
  let user;
  try {
    user = await requireActionPermission("workflow.request");
  } catch (error) {
    return {
      status: "error",
      message: error instanceof ForbiddenError ? error.message : "Please sign in again.",
    };
  }
  const parsed = contentRequestSchema.safeParse({
    brief: formData.get("brief"),
    channel: formData.get("channel"),
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the request." };
  }

  try {
    const started = await startContentRequest(user, parsed.data);
    if (getEnv().AGENT_EXECUTION === "queue") {
      await enqueue(QUEUES.contentWorkflow, { taskId: started.taskId, channel: started.channel });
      revalidatePath("/command-center");
      return { status: "queued", taskId: started.taskId };
    }
    const result = await runContentWorkflow(started.taskId, started.channel);
    revalidatePath("/command-center");
    revalidatePath("/approvals");
    return result;
  } catch (error) {
    console.error("[requestContent]", error);
    return { status: "error", message: "The request could not be started. Nothing was sent." };
  }
}
