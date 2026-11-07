"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionError, type ActionState } from "@/server/action-result";
import { requireUser } from "@/server/auth/session";
import {
  createDraft,
  rewriteCaption,
  scheduleContent,
  submitDraft,
  updateDraft,
} from "@/server/content/studio";

function draftInput(formData: FormData) {
  const hashtags = String(formData.get("hashtags") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`));
  const planned = String(formData.get("plannedFor") ?? "");
  return {
    title: String(formData.get("title") ?? ""),
    caption: String(formData.get("caption") ?? ""),
    hashtags,
    channel: String(formData.get("channel") ?? "") as never,
    plannedFor: planned ? `${planned}T12:00:00` : undefined,
  };
}

function refresh(id?: string) {
  revalidatePath("/content");
  if (id) revalidatePath(`/content/${id}`);
  revalidatePath("/my-team");
  revalidatePath("/approvals");
}

export async function createDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id: string;
  try {
    const user = await requireUser();
    const item = await createDraft(user, draftInput(formData));
    id = item.id;
    refresh();
  } catch (error) {
    return actionError(error);
  }
  redirect(`/content/${id}`);
}

export async function updateDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await requireUser();
    await updateDraft(user, id, draftInput(formData));
    refresh(id);
    return { status: "done", message: "Draft saved." };
  } catch (error) {
    return actionError(error);
  }
}

export async function submitDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await requireUser();
    const { check } = await submitDraft(user, id, {
      why: String(formData.get("why") ?? "") || undefined,
    });
    refresh(id);
    return {
      status: "done",
      message:
        check.outcome === "PASS"
          ? "Sent for review. Compliance check passed."
          : `Sent for review with ${check.violations.length} compliance finding(s). Management will decide.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export type RewriteState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; variants: { label: string; caption: string }[] };

export async function rewriteAction(
  _prev: RewriteState,
  formData: FormData,
): Promise<RewriteState> {
  try {
    const user = await requireUser();
    const variants = await rewriteCaption(
      user,
      String(formData.get("id") ?? ""),
      String(formData.get("instruction") ?? "") || undefined,
    );
    return { status: "done", variants };
  } catch (error) {
    const result = actionError(error);
    return {
      status: "error",
      message: result.status === "error" ? result.message : "Could not get suggestions.",
    };
  }
}

export async function scheduleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await requireUser();
    const raw = String(formData.get("at") ?? "");
    const offset = Number(formData.get("tzOffset") ?? 0);
    // datetime-local has no zone: apply the browser's offset so the time means what the person picked.
    const at = new Date(new Date(`${raw}:00Z`).getTime() + offset * 60_000);
    await scheduleContent(user, id, { at });
    refresh(id);
    return { status: "done", message: "Scheduled in GoHighLevel." };
  } catch (error) {
    return actionError(error);
  }
}
