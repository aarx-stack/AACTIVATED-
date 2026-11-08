"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/server/action-result";
import { requireActionPermission } from "@/server/auth/session";
import {
  addSection,
  createPublication,
  deleteSection,
  moveSection,
  PublicationStateError,
  submitPublication,
  updateSection,
  writeSectionWithAI,
} from "@/server/publishing/service";

function failure(error: unknown): ActionState {
  if (error instanceof PublicationStateError) return { status: "error", message: error.message };
  return actionError(error);
}

const refresh = (id: string) => {
  revalidatePath("/content/publishing");
  revalidatePath(`/content/publishing/${id}`);
};

export async function createPublicationAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let id: string;
  try {
    const actor = await requireActionPermission("publishing.manage");
    const p = await createPublication(actor, {
      title: String(form.get("title") ?? ""),
      subtitle: String(form.get("subtitle") ?? ""),
      kind: String(form.get("kind") ?? "") as never,
      audience: String(form.get("audience") ?? ""),
      description: String(form.get("description") ?? ""),
      outlineWithAI: form.get("outlineWithAI") === "on",
      sectionCount: String(form.get("sectionCount") ?? "6"),
    });
    id = p.id;
  } catch (error) {
    return failure(error);
  }
  redirect(`/content/publishing/${id}`);
}

export async function addSectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let target: string;
  try {
    const actor = await requireActionPermission("publishing.manage");
    const id = String(form.get("publicationId") ?? "");
    const section = await addSection(actor, id, String(form.get("title") ?? ""));
    refresh(id);
    target = `/content/publishing/${id}?part=${section.id}`;
  } catch (error) {
    return failure(error);
  }
  redirect(target);
}

export async function updateSectionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("publishing.manage");
    const section = await updateSection(actor, String(form.get("sectionId") ?? ""), {
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
      body: String(form.get("body") ?? ""),
    });
    refresh(section.publicationId);
    return { status: "done", message: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function writeSectionAction(
  sectionId: string,
  note: string,
): Promise<{ ok: true; body: string; writtenBy: string } | { ok: false; error: string }> {
  try {
    const actor = await requireActionPermission("publishing.manage");
    const section = await writeSectionWithAI(actor, sectionId, note);
    refresh(section.publicationId);
    return { ok: true, body: section.body, writtenBy: section.writtenBy ?? "" };
  } catch (error) {
    const state = failure(error);
    return { ok: false, error: state.status === "error" ? state.message : "Try again." };
  }
}

export async function moveSectionAction(sectionId: string, direction: "up" | "down") {
  const actor = await requireActionPermission("publishing.manage");
  try {
    await moveSection(actor, sectionId, direction === "up" ? "up" : "down");
  } catch (error) {
    if (!(error instanceof PublicationStateError)) throw error;
  }
  revalidatePath("/content/publishing", "layout");
}

export async function deleteSectionAction(sectionId: string) {
  const actor = await requireActionPermission("publishing.manage");
  const id = await deleteSection(actor, sectionId);
  refresh(id);
  redirect(`/content/publishing/${id}`);
}

export async function submitPublicationAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await requireActionPermission("publishing.manage");
    const id = String(form.get("publicationId") ?? "");
    const request = await submitPublication(actor, id);
    refresh(id);
    revalidatePath("/approvals");
    return {
      status: "done",
      message: "Sent for executive approval.",
      href: `/approvals/${request.id}`,
      hrefLabel: "View the request",
    };
  } catch (error) {
    return failure(error);
  }
}
