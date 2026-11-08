"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EmailAudience } from "@/generated/prisma/enums";
import { getEnv } from "@/lib/env";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz/permissions";
import {
  CampaignStateError,
  draftWithAI,
  saveCampaign,
  sendCampaign,
  submitCampaign,
} from "@/server/email/campaigns";
import { enqueue } from "@/server/jobs/client";
import { QUEUES } from "@/server/jobs/queues";

function refresh(id?: string) {
  revalidatePath("/content/email");
  if (id) revalidatePath(`/content/email/${id}`);
  revalidatePath("/approvals");
}

function failure(error: unknown): ActionState {
  if (error instanceof CampaignStateError) return { status: "error", message: error.message };
  return actionError(error);
}

export async function saveCampaignAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  const existing = String(form.get("id") ?? "") || undefined;
  try {
    const actor = await requireActionPermission("email.campaigns");
    const saved = await saveCampaign(actor, {
      id: existing,
      name: String(form.get("name") ?? ""),
      audience: String(form.get("audience") ?? "") as EmailAudience,
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("body") ?? ""),
    });
    id = saved.id;
    refresh(id);
  } catch (error) {
    return failure(error);
  }
  if (!existing) redirect(`/content/email/${id}`);
  return { status: "done", message: "Saved." };
}

export async function draftWithAIAction(input: {
  brief: string;
  audience: string;
}): Promise<{ ok: true; subject: string; body: string } | { ok: false; error: string }> {
  try {
    const actor = await requireActionPermission("email.campaigns");
    const draft = await draftWithAI(actor, {
      brief: input.brief,
      audience: z.nativeEnum(EmailAudience).parse(input.audience),
    });
    return { ok: true, ...draft };
  } catch (error) {
    const state = failure(error);
    return { ok: false, error: state.status === "error" ? state.message : "Try again." };
  }
}

export async function submitCampaignAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("email.campaigns");
    const id = String(form.get("id") ?? "");
    const request = await submitCampaign(actor, id);
    refresh(id);
    return {
      status: "done",
      message: `Sent for approval. ${request.requiredRole === "EXECUTIVE" ? "An executive" : "Someone other than you"} will decide.`,
      href: `/approvals/${request.id}`,
      hrefLabel: "View the request",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function sendCampaignAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("email.campaigns");
    const id = String(form.get("id") ?? "");
    if (getEnv().AGENT_EXECUTION === "queue") {
      await enqueue(QUEUES.emailCampaign, { campaignId: id, actorId: actor.id });
      refresh(id);
      return { status: "done", message: "Sending in the background. Refresh to see progress." };
    }
    const result = await sendCampaign(actor, id);
    refresh(id);
    return {
      status: "done",
      message: `Sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}. ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ""}.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: "error", message: error.message };
    return failure(error);
  }
}
