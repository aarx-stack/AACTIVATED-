"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import { chatWithBrain, restoreVersion, saveTemplate, sendToAgent } from "@/server/prompts/service";

export type ChatResult =
  | {
      ok: true;
      reply: string;
      template: { name: string; description: string; body: string; variables: string[] } | null;
    }
  | { ok: false; error: string };

export async function chatAction(input: {
  message: string;
  history: { role: "user" | "brain"; text: string }[];
  template: { name: string; body: string } | null;
}): Promise<ChatResult> {
  try {
    const actor = await requireActionPermission("prompts.use");
    const result = await chatWithBrain(actor, input);
    revalidatePath("/command-center");
    return { ok: true, ...result };
  } catch (error) {
    const state = actionError(error);
    return { ok: false, error: state.status === "error" ? state.message : "Try again." };
  }
}

export async function saveTemplateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("prompts.use");
    const templateId = String(form.get("templateId") ?? "") || undefined;
    const result = await saveTemplate(actor, {
      templateId,
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      body: String(form.get("body") ?? ""),
      changeNote: String(form.get("changeNote") ?? ""),
    });
    revalidatePath("/prompts");
    return {
      status: "done",
      message: templateId ? `Saved as version ${result.version}.` : "Template created.",
      href: templateId ? undefined : `/prompts?template=${result.template.id}`,
      hrefLabel: "Open it",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function restoreVersionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("prompts.use");
    const result = await restoreVersion(
      actor,
      z.string().min(1).parse(form.get("templateId")),
      z.coerce.number().int().positive().parse(form.get("version")),
    );
    revalidatePath("/prompts");
    return { status: "done", message: `Restored as version ${result.version}.` };
  } catch (error) {
    return actionError(error);
  }
}

export async function sendToAgentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("prompts.use");
    const values: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("var_")) values[key.slice(4)] = String(value);
    }
    const { agent } = await sendToAgent(actor, {
      templateId: String(form.get("templateId") ?? ""),
      agentId: String(form.get("agentId") ?? ""),
      values,
    });
    revalidatePath(`/agents/${agent.id}`);
    return {
      status: "done",
      message: `Sent to ${agent.title} (${agent.name}). It is on their task board.`,
      href: `/agents/${agent.id}`,
      hrefLabel: "Open workspace",
    };
  } catch (error) {
    return actionError(error);
  }
}
