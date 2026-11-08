"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import { createDocument, summarizeDocument } from "@/server/knowledge/service";

export async function summarizeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("knowledge.manage");
    const doc = await summarizeDocument(actor, z.string().min(1).parse(form.get("documentId")));
    revalidatePath("/knowledge");
    revalidatePath(`/knowledge/${doc.id}`);
    return { status: "done", message: "Summary updated." };
  } catch (error) {
    return actionError(error);
  }
}

export async function createDocumentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("knowledge.manage");
    const doc = await createDocument(actor, {
      title: String(form.get("title") ?? ""),
      category: String(form.get("category") ?? "") as never,
      accessLevel: String(form.get("accessLevel") ?? "") as never,
      body: String(form.get("body") ?? ""),
      tags: String(form.get("tags") ?? ""),
    });
    // Best effort: the summary can be generated later if the Brain is paused.
    let summarized = true;
    try {
      await summarizeDocument(actor, doc.id);
    } catch {
      summarized = false;
    }
    revalidatePath("/knowledge");
    return {
      status: "done",
      message: summarized
        ? "Document added with an AI summary."
        : "Document added. The AI summary can be generated from the library.",
      href: `/knowledge/${doc.id}`,
      hrefLabel: "Open document",
    };
  } catch (error) {
    return actionError(error);
  }
}
